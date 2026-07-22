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
  validateExpectedReproductionIds,
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

export class UnterminatedReviewerChildError extends Error {
  constructor(message = 'Claude child did not exit after SIGKILL') {
    super(message);
    this.name = 'UnterminatedReviewerChildError';
  }
}

export class ReviewerOutputLimitError extends Error {
  constructor() {
    super('Claude output exceeded 10 MiB capture limit');
    this.name = 'ReviewerOutputLimitError';
  }
}

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
    let preserveDirectory = false;
    let retryableFailure = false;
    let timedOut = false;
    let timer;
    const timeoutError = new Error(`Reviewer timed out after ${timeoutMs} ms`);

    try {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(timeoutError);
      }, timeoutMs);
      let output;
      try {
        // Injected launchers must honor AbortSignal and settle only after any
        // process or resource they own has stopped using this attempt cwd.
        output = await launch({ cwd: directory, input: prompt, signal: controller.signal });
      } catch (error) {
        if (error instanceof UnterminatedReviewerChildError) throw error;
        if (error instanceof ReviewerOutputLimitError) throw error;
        if (timedOut && error === controller.signal.reason) {
          retryableFailure = true;
          throw error;
        }
        if (timedOut && error?.name === 'AbortError') {
          retryableFailure = true;
          throw new Error(`Reviewer timed out after ${timeoutMs} ms`, { cause: error });
        }
        throw error;
      }
      if (timedOut) {
        retryableFailure = true;
        throw timeoutError;
      }
      if (typeof output !== 'string') {
        retryableFailure = true;
        throw new TypeError('launch must resolve to a string');
      }
      try {
        return await validate(output);
      } catch (error) {
        retryableFailure = true;
        throw error;
      }
    } catch (error) {
      if (error instanceof UnterminatedReviewerChildError) {
        preserveDirectory = true;
        throw error;
      }
      if (!retryableFailure || attempt === retries) throw error;
    } finally {
      clearTimeout(timer);
      if (!preserveDirectory) await removeReviewDirectory(directory);
    }
  }

  throw new Error('Reviewer attempts exhausted');
}

export function launchClaude(
  { cwd, input, signal },
  {
    spawnImpl = spawn,
    termGraceMs = 1_000,
    killGuardMs = 1_000,
  } = {},
) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    let settled = false;
    let capturedBytes = 0;
    const stdout = [];
    const stderr = [];
    let child;
    let exitCode;
    let exitSignal;
    let termTimer;
    let killGuardTimer;
    let termination;
    let lifecycleCleared = false;

    const clearLifecycle = () => {
      if (lifecycleCleared) return;
      lifecycleCleared = true;
      clearTimeout(termTimer);
      clearTimeout(killGuardTimer);
      signal?.removeEventListener('abort', abort);
      child?.off('error', childError);
      child?.off('exit', childExit);
      child?.off('close', childClose);
      child?.stdin?.off('error', stdinError);
      child?.stdout?.off('data', captureStdout);
      child?.stderr?.off('data', captureStderr);
    };

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearLifecycle();
      if (error) rejectLaunch(error);
      else resolveLaunch(value);
    };
    const unterminated = () => finish(new UnterminatedReviewerChildError());
    const startKillGuard = () => {
      killGuardTimer = setTimeout(unterminated, killGuardMs);
    };
    const sendSignal = (value) => {
      if (settled) return;
      termination.killSent = true;
      try {
        child.kill(value);
      } catch (error) {
        termination.signalError = error;
      }
    };
    const beginTermination = (error, firstSignal) => {
      if (settled || termination) return;
      termination = { error, killSent: false, signalError: undefined };
      sendSignal(firstSignal);
      if (firstSignal === 'SIGKILL') {
        startKillGuard();
        return;
      }
      termTimer = setTimeout(() => {
        if (settled) return;
        sendSignal('SIGKILL');
        startKillGuard();
      }, termGraceMs);
    };
    const abort = () => {
      const error = new Error('Claude review aborted');
      error.name = 'AbortError';
      beginTermination(error, 'SIGTERM');
    };
    const capture = (target) => (chunk) => {
      if (settled || termination) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      capturedBytes += bytes.length;
      if (capturedBytes > MAX_CAPTURE_BYTES) {
        beginTermination(new ReviewerOutputLimitError(), 'SIGKILL');
        return;
      }
      target.push(bytes);
    };
    const captureStdout = capture(stdout);
    const captureStderr = capture(stderr);
    const childError = (error) => {
      if (termination?.killSent) return;
      finish(error);
    };
    const stdinError = (error) => {
      beginTermination(error, 'SIGTERM');
    };
    const childExit = (code, signalValue) => {
      exitCode = code;
      exitSignal = signalValue;
    };
    const childClose = (code, closeSignal) => {
      if (termination) {
        finish(termination.error);
        return;
      }
      const finalCode = code ?? exitCode;
      const finalSignal = closeSignal ?? exitSignal;
      if (finalCode === 0) {
        finish(undefined, Buffer.concat(stdout).toString('utf8'));
        return;
      }
      const diagnostic = Buffer.concat(stderr).toString('utf8').trim();
      const reason = finalCode === null || finalCode === undefined
        ? `signal ${finalSignal ?? 'unknown'}`
        : `code ${finalCode}`;
      finish(new Error(
        diagnostic.length > 0
          ? `Claude exited with ${reason}: ${diagnostic}`
          : `Claude exited with ${reason}`,
      ));
    };

    try {
      child = spawnImpl('claude', CLAUDE_REVIEW_ARGS, {
        cwd,
        shell: false,
        env: minimalEnvironment,
      });
      child.stdout.on('data', captureStdout);
      child.stderr.on('data', captureStderr);
      child.on('error', childError);
      child.on('exit', childExit);
      child.on('close', childClose);
      child.stdin.on('error', stdinError);
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
    '  reviewer-runner.mjs run-claude --prompt-file FILE --protocol brb-review --angle ANGLE --timeout-ms NUMBER --output FILE',
    '  reviewer-runner.mjs run-claude --prompt-file FILE --protocol brb-reproduction --expected-ids-file IDS.json --timeout-ms NUMBER --output FILE',
    '  reviewer-runner.mjs run-claude --prompt-file FILE --protocol brb-verification --timeout-ms NUMBER --output FILE',
  ].join('\n');
}

function readOptions(args) {
  const allowed = new Set([
    'prompt-file',
    'protocol',
    'angle',
    'expected-ids-file',
    'timeout-ms',
    'output',
  ]);
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

function protocolValidator(protocol, angle, expectedIds) {
  const validators = {
    'brb-review': (value) => validateReviewResult(value, angle),
    'brb-reproduction': (value) => validateReproductionResult(value, expectedIds),
    'brb-verification': validateVerificationResult,
  };
  const validate = validators[protocol];
  if (!validate) throw new TypeError('--protocol is unsupported');
  if (protocol === 'brb-review' && angle === undefined) {
    throw new TypeError('--angle is required for brb-review');
  }
  if (protocol !== 'brb-review' && angle !== undefined) {
    throw new TypeError('--angle is supported only for brb-review');
  }
  if (protocol === 'brb-reproduction' && expectedIds === undefined) {
    throw new TypeError('--expected-ids-file is required for brb-reproduction');
  }
  if (protocol !== 'brb-reproduction' && expectedIds !== undefined) {
    throw new TypeError('--expected-ids-file is supported only for brb-reproduction');
  }
  return (output) => validate(parseProtocolBlock(output, protocol));
}

function parseJsonInput(text, input) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${input}: ${error.message}`);
  }
}

export async function main(args, dependencies = {}) {
  const [command, ...rest] = args;
  if (command !== 'run-claude') throw new Error(usage());

  const options = readOptions(rest);
  const promptFile = requireOption(options, 'prompt-file');
  const protocol = requireOption(options, 'protocol');
  const angle = options.angle;
  const expectedIdsFile = options['expected-ids-file'];
  const output = requireOption(options, 'output');
  const timeoutMs = timeoutOption(requireOption(options, 'timeout-ms'));
  const readFile = dependencies.readFile ?? readFileDefault;
  const writeFile = dependencies.writeFile ?? writeFileDefault;
  const launch = dependencies.launch ?? launchClaude;
  let expectedIds;
  if (protocol === 'brb-reproduction') {
    const path = requireOption(options, 'expected-ids-file');
    expectedIds = validateExpectedReproductionIds(parseJsonInput(
      await readFile(path, 'utf8'),
      path,
    ));
  } else if (expectedIdsFile !== undefined) {
    throw new TypeError('--expected-ids-file is supported only for brb-reproduction');
  }
  const validate = protocolValidator(protocol, angle, expectedIds);
  const prompt = await readFile(promptFile, 'utf8');
  const result = await runReviewer({
    prompt,
    launch,
    validate,
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
