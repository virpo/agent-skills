#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  mkdtemp,
  readFile as readFileDefault,
  rm,
  writeFile as writeFileDefault,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseProtocolBlock,
  validateReproductionResult,
  validateReviewResult,
  validateVerificationResult,
} from './review-protocol.mjs';

const REVIEW_DIRECTORY_PREFIX = join(tmpdir(), 'blast-radius-buddy-review-');
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;
const REVIEW_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL',
  'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN',
];
const minimalEnvironment = Object.fromEntries(
  REVIEW_ENV_KEYS.flatMap(
    (key) => process.env[key] === undefined ? [] : [[key, process.env[key]]],
  ),
);

export const CLAUDE_REVIEW_ARGS = Object.freeze([
  '--safe-mode', '--tools', '', '--disable-slash-commands',
  '--no-session-persistence', '--permission-mode', 'plan', '--print',
]);

function validateRunOptions({ prompt, launch, validate, timeoutMs, retries }) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new TypeError('prompt must be a non-empty string');
  }
  if (typeof launch !== 'function') throw new TypeError('launch must be a function');
  if (typeof validate !== 'function') throw new TypeError('validate must be a function');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
    throw new TypeError('timeoutMs must be an integer from 1 to 600000');
  }
  if (retries !== 0 && retries !== 1) {
    throw new TypeError('retries must be 0 or 1');
  }
}

async function removeReviewDirectory(directory) {
  if (typeof directory !== 'string' || !directory.startsWith(REVIEW_DIRECTORY_PREFIX)) {
    throw new Error('Refusing to remove an unsafe review directory');
  }
  await rm(directory, { recursive: true, force: true });
}

export async function runReviewer({
  prompt,
  launch,
  validate,
  timeoutMs = 420_000,
  retries = 1,
}) {
  validateRunOptions({ prompt, launch, validate, timeoutMs, retries });

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const directory = await mkdtemp(REVIEW_DIRECTORY_PREFIX);
    const controller = new AbortController();
    let timer;

    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Reviewer timed out after ${timeoutMs} ms`));
        }, timeoutMs);
      });
      const output = await Promise.race([
        launch({ cwd: directory, input: prompt, signal: controller.signal }),
        timeout,
      ]);
      if (typeof output !== 'string') {
        throw new TypeError('launch must resolve to a string');
      }
      return await validate(output);
    } catch (error) {
      if (attempt === retries) throw error;
    } finally {
      clearTimeout(timer);
      await removeReviewDirectory(directory);
    }
  }

  throw new Error('Reviewer attempts exhausted');
}

export function launchClaude(
  { cwd, input, signal },
  { spawnImpl = spawn } = {},
) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    let settled = false;
    let capturedBytes = 0;
    const stdout = [];
    const stderr = [];
    let child;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) rejectLaunch(error);
      else resolveLaunch(value);
    };
    const abort = () => {
      child?.kill('SIGTERM');
      const error = new Error('Claude review aborted');
      error.name = 'AbortError';
      finish(error);
    };
    const capture = (target) => (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      capturedBytes += bytes.length;
      if (capturedBytes > MAX_CAPTURE_BYTES) {
        child.kill('SIGKILL');
        finish(new Error('Claude output exceeded 10 MiB capture limit'));
        return;
      }
      target.push(bytes);
    };

    try {
      child = spawnImpl('claude', CLAUDE_REVIEW_ARGS, {
        cwd,
        shell: false,
        env: minimalEnvironment,
      });
      child.stdout.on('data', capture(stdout));
      child.stderr.on('data', capture(stderr));
      child.on('error', finish);
      child.stdin.on('error', finish);
      child.on('close', (code, closeSignal) => {
        if (code === 0) {
          finish(undefined, Buffer.concat(stdout).toString('utf8'));
          return;
        }
        const diagnostic = Buffer.concat(stderr).toString('utf8').trim();
        const reason = code === null
          ? `signal ${closeSignal ?? 'unknown'}`
          : `code ${code}`;
        finish(new Error(
          diagnostic.length > 0
            ? `Claude exited with ${reason}: ${diagnostic}`
            : `Claude exited with ${reason}`,
        ));
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      child.stdin.end(input);
    } catch (error) {
      finish(error);
    }
  });
}

function usage() {
  return [
    'Usage:',
    '  reviewer-runner.mjs run-claude --prompt-file FILE --protocol brb-review|brb-reproduction|brb-verification --timeout-ms NUMBER --output FILE',
  ].join('\n');
}

function readOptions(args) {
  const allowed = new Set(['prompt-file', 'protocol', 'timeout-ms', 'output']);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    const name = flag?.startsWith('--') ? flag.slice(2) : undefined;
    if (!name || !allowed.has(name) || value === undefined || options[name] !== undefined) {
      throw new Error(usage());
    }
    options[name] = value;
  }
  return options;
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function timeoutOption(value) {
  if (!/^\d+$/.test(value)) {
    throw new TypeError('--timeout-ms must be an integer from 1 to 600000');
  }
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
    throw new TypeError('--timeout-ms must be an integer from 1 to 600000');
  }
  return timeoutMs;
}

function protocolValidator(protocol) {
  const validators = {
    'brb-review': validateReviewResult,
    'brb-reproduction': validateReproductionResult,
    'brb-verification': validateVerificationResult,
  };
  const validate = validators[protocol];
  if (!validate) throw new TypeError('--protocol is unsupported');
  return (output) => validate(parseProtocolBlock(output, protocol));
}

export async function main(args, dependencies = {}) {
  const [command, ...rest] = args;
  if (command !== 'run-claude') throw new Error(usage());

  const options = readOptions(rest);
  const promptFile = requireOption(options, 'prompt-file');
  const protocol = requireOption(options, 'protocol');
  const output = requireOption(options, 'output');
  const timeoutMs = timeoutOption(requireOption(options, 'timeout-ms'));
  const readFile = dependencies.readFile ?? readFileDefault;
  const writeFile = dependencies.writeFile ?? writeFileDefault;
  const launch = dependencies.launch ?? launchClaude;
  const prompt = await readFile(promptFile, 'utf8');
  const result = await runReviewer({
    prompt,
    launch,
    validate: protocolValidator(protocol),
    timeoutMs,
    retries: 1,
  });

  await writeFile(output, `${JSON.stringify(result)}\n`, 'utf8');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
