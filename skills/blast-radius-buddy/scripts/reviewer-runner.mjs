#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  mkdtemp,
  readFile as readFileDefault,
  rm,
  writeFile as writeFileDefault,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseProtocolBlock,
  validateExpectedReproductionIds,
  validateExpectedVerificationIds,
  validateReproductionResult,
  validateReviewResult,
  validateVerificationResult,
} from './review-protocol.mjs';

const REVIEW_DIRECTORY_PREFIX = join(tmpdir(), 'blast-radius-buddy-review-');
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;
const BASE_REVIEW_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SHELL',
];
const CLAUDE_ENV_KEYS = [
  ...BASE_REVIEW_ENV_KEYS, 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN',
];
const CODEX_ENV_KEYS = [...BASE_REVIEW_ENV_KEYS, 'CODEX_HOME', 'OPENAI_API_KEY'];
const minimalEnvironment = (keys) => Object.fromEntries(
  keys.flatMap(
    (key) => process.env[key] === undefined ? [] : [[key, process.env[key]]],
  ),
);

export const CLAUDE_REVIEW_ARGS = Object.freeze([
  '--safe-mode', '--tools', '', '--disable-slash-commands',
  '--no-session-persistence', '--permission-mode', 'plan', '--print',
  '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
]);
export const CLAUDE_REPOSITORY_REVIEW_ARGS = Object.freeze([
  '--safe-mode', '--tools', 'Read,Glob,Grep', '--disable-slash-commands',
  '--no-session-persistence', '--permission-mode', 'dontAsk', '--print',
  '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
  '--effort', 'medium', '--prompt-suggestions', 'false',
]);
export const CODEX_REVIEW_ARGS = Object.freeze([
  'exec', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only',
  '--skip-git-repo-check', '--model', 'gpt-5.6-sol', '-',
]);

export class UnterminatedReviewerChildError extends Error {
  constructor(provider = 'Claude') {
    super(`${provider} child did not exit after SIGKILL`);
    this.name = 'UnterminatedReviewerChildError';
  }
}

export class ReviewerOutputLimitError extends Error {
  constructor(provider = 'Claude') {
    super(`${provider} output exceeded 10 MiB capture limit`);
    this.name = 'ReviewerOutputLimitError';
  }
}

export class ReviewerInactivityError extends Error {
  constructor(timeoutMs) {
    super(`Reviewer produced no activity for ${timeoutMs} ms`);
    this.name = 'ReviewerInactivityError';
  }
}

function validateRunOptions({
  prompt,
  launch,
  validate,
  timeoutMs,
  inactivityTimeoutMs,
  retries,
  signal,
  onAttemptEvent,
  stageDeadlineAt,
  workingDirectory,
  now,
}) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new TypeError('prompt must be a non-empty string');
  }
  if (typeof launch !== 'function') throw new TypeError('launch must be a function');
  if (typeof validate !== 'function') throw new TypeError('validate must be a function');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1_800_000) {
    throw new TypeError('timeoutMs must be an integer from 1 to 1800000');
  }
  if (!Number.isInteger(inactivityTimeoutMs)
    || inactivityTimeoutMs < 1
    || inactivityTimeoutMs > timeoutMs) {
    throw new TypeError('inactivityTimeoutMs must be an integer from 1 through timeoutMs');
  }
  if (retries !== 0 && retries !== 1) {
    throw new TypeError('retries must be 0 or 1');
  }
  if (signal !== undefined
    && (typeof signal !== 'object'
      || typeof signal.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function')) {
    throw new TypeError('signal must be an AbortSignal');
  }
  if (onAttemptEvent !== undefined && typeof onAttemptEvent !== 'function') {
    throw new TypeError('onAttemptEvent must be a function');
  }
  if (stageDeadlineAt !== undefined
    && (!Number.isSafeInteger(stageDeadlineAt) || stageDeadlineAt <= 0)) {
    throw new TypeError('stageDeadlineAt must be a positive safe integer');
  }
  if (workingDirectory !== undefined
    && (typeof workingDirectory !== 'string' || !isAbsolute(workingDirectory))) {
    throw new TypeError('workingDirectory must be an absolute path');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
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
  inactivityTimeoutMs = Math.min(300_000, timeoutMs),
  retries = 1,
  signal,
  onAttemptEvent,
  stageDeadlineAt,
  workingDirectory,
  now = () => Date.now(),
}) {
  validateRunOptions({
    prompt,
    launch,
    validate,
    timeoutMs,
    inactivityTimeoutMs,
    retries,
    signal,
    onAttemptEvent,
    stageDeadlineAt,
    workingDirectory,
    now,
  });
  if (signal?.aborted) throw signal.reason;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const remainingStageMs = stageDeadlineAt === undefined
      ? timeoutMs
      : stageDeadlineAt - now();
    if (remainingStageMs <= 0) throw new Error('Reviewer stage deadline elapsed');
    const attemptTimeoutMs = Math.min(timeoutMs, remainingStageMs);
    const attemptInactivityTimeoutMs = Math.min(inactivityTimeoutMs, attemptTimeoutMs);
    const ownsDirectory = workingDirectory === undefined;
    const directory = ownsDirectory
      ? await mkdtemp(REVIEW_DIRECTORY_PREFIX)
      : workingDirectory;
    const controller = new AbortController();
    let preserveDirectory = false;
    let retryableFailure = false;
    let watchdogError;
    let hardTimer;
    let inactivityTimer;
    let lastActivityAt = now();
    const timeoutError = new Error(`Reviewer timed out after ${attemptTimeoutMs} ms`);
    const abortFromParent = () => controller.abort(signal.reason);
    const event = (state, failureCategory = null) => onAttemptEvent?.({
      state,
      attempt: attempt + 1,
      failureCategory,
      lastActivityAgeMs: Math.max(0, now() - lastActivityAt),
    });
    const abortFromWatchdog = (error) => {
      if (controller.signal.aborted) return;
      watchdogError = error;
      controller.abort(error);
    };
    const resetInactivityTimer = () => {
      lastActivityAt = now();
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(
        () => abortFromWatchdog(new ReviewerInactivityError(attemptInactivityTimeoutMs)),
        attemptInactivityTimeoutMs,
      );
    };

    try {
      event('start');
      signal?.addEventListener('abort', abortFromParent, { once: true });
      if (signal?.aborted) {
        abortFromParent();
        throw signal.reason;
      }
      hardTimer = setTimeout(() => abortFromWatchdog(timeoutError), attemptTimeoutMs);
      resetInactivityTimer();
      let output;
      try {
        // Injected launchers must honor AbortSignal and settle only after any
        // process or resource they own has stopped using this attempt cwd.
        output = await launch({
          cwd: directory,
          input: prompt,
          signal: controller.signal,
          onActivity: resetInactivityTimer,
        });
      } catch (error) {
        if (error instanceof UnterminatedReviewerChildError) throw error;
        if (error instanceof ReviewerOutputLimitError) throw error;
        if (signal?.aborted) throw signal.reason;
        if (watchdogError && error === controller.signal.reason) {
          retryableFailure = true;
          throw error;
        }
        if (watchdogError && error?.name === 'AbortError') {
          retryableFailure = true;
          throw new Error(watchdogError.message, { cause: error });
        }
        throw error;
      }
      if (signal?.aborted) throw signal.reason;
      if (watchdogError) {
        retryableFailure = true;
        throw watchdogError;
      }
      if (typeof output !== 'string') {
        retryableFailure = true;
        throw new TypeError('launch must resolve to a string');
      }
      try {
        const result = await validate(output);
        event('complete');
        return result;
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
      const failureCategory = watchdogError instanceof ReviewerInactivityError
        ? 'inactivity'
        : watchdogError
          ? 'timeout'
          : 'malformed-output';
      event('retry', failureCategory);
    } finally {
      clearTimeout(hardTimer);
      clearTimeout(inactivityTimer);
      signal?.removeEventListener('abort', abortFromParent);
      if (ownsDirectory && !preserveDirectory) await removeReviewDirectory(directory);
    }
  }

  throw new Error('Reviewer attempts exhausted');
}

function launchReviewerChild(
  { cwd, input, signal, onActivity },
  {
    provider,
    command,
    args,
    environmentKeys,
    spawnImpl = spawn,
    termGraceMs = 1_000,
    killGuardMs = 1_000,
  } = {},
) {
  if (onActivity !== undefined && typeof onActivity !== 'function') {
    throw new TypeError('onActivity must be a function');
  }
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
    const unterminated = () => finish(new UnterminatedReviewerChildError(provider));
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
      const error = new Error(`${provider} review aborted`);
      error.name = 'AbortError';
      beginTermination(error, 'SIGTERM');
    };
    const capture = (target) => (chunk) => {
      if (settled || termination) return;
      onActivity?.();
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      capturedBytes += bytes.length;
      if (capturedBytes > MAX_CAPTURE_BYTES) {
        beginTermination(new ReviewerOutputLimitError(provider), 'SIGKILL');
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
          ? `${provider} exited with ${reason}: ${diagnostic}`
          : `${provider} exited with ${reason}`,
      ));
    };

    try {
      child = spawnImpl(command, args, {
        cwd,
        shell: false,
        env: minimalEnvironment(environmentKeys),
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

function parseClaudeStream(text) {
  const events = text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid Claude stream JSON: ${error.message}`);
      }
    });
  const results = events.filter((event) => event?.type === 'result');
  if (results.length !== 1
    || results[0].subtype !== 'success'
    || typeof results[0].result !== 'string'
    || results[0].result.trim().length === 0) {
    throw new Error('Claude stream must contain exactly one successful Claude result');
  }
  return results[0].result;
}

export async function launchClaude(
  options,
  { model, repositoryAccess = false, ...dependencies } = {},
) {
  if (model !== undefined && (typeof model !== 'string' || model.trim().length === 0)) {
    throw new TypeError('Claude model must be a non-empty string');
  }
  if (typeof repositoryAccess !== 'boolean') {
    throw new TypeError('repositoryAccess must be a boolean');
  }
  const output = await launchReviewerChild(options, {
    ...dependencies,
    provider: 'Claude',
    command: 'claude',
    args: [
      ...(repositoryAccess ? CLAUDE_REPOSITORY_REVIEW_ARGS : CLAUDE_REVIEW_ARGS),
      ...(model === undefined ? [] : ['--model', model]),
    ],
    environmentKeys: CLAUDE_ENV_KEYS,
  });
  return parseClaudeStream(output);
}

export function launchCodex(
  options,
  { model, repositoryAccess = false, ...dependencies } = {},
) {
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new TypeError('Codex model must be a non-empty string');
  }
  if (typeof repositoryAccess !== 'boolean') {
    throw new TypeError('repositoryAccess must be a boolean');
  }
  const args = [
    'exec', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only',
    '--skip-git-repo-check', '--model', model,
    ...(repositoryAccess ? ['-C', options.cwd] : []),
    '-',
  ];
  return launchReviewerChild(options, {
    ...dependencies,
    provider: 'Codex',
    command: 'codex',
    args,
    environmentKeys: CODEX_ENV_KEYS,
  });
}

function usage() {
  return [
    'Usage:',
    '  reviewer-runner.mjs run-claude --model MODEL --prompt-file FILE --protocol brb-review --angle ANGLE --timeout-ms NUMBER [--inactivity-timeout-ms NUMBER] --output FILE',
    '  reviewer-runner.mjs run-claude --model MODEL --prompt-file FILE --protocol brb-reproduction --expected-ids-file IDS.json --timeout-ms NUMBER [--inactivity-timeout-ms NUMBER] --output FILE',
    '  reviewer-runner.mjs run-claude --model MODEL --prompt-file FILE --protocol brb-verification --expected-ids-file IDS.json --timeout-ms NUMBER [--inactivity-timeout-ms NUMBER] --output FILE',
    '  reviewer-runner.mjs run-codex --model MODEL --prompt-file FILE --protocol brb-review --angle ANGLE --timeout-ms NUMBER [--inactivity-timeout-ms NUMBER] --output FILE',
    '  reviewer-runner.mjs run-codex --model MODEL --prompt-file FILE --protocol brb-reproduction --expected-ids-file IDS.json --timeout-ms NUMBER [--inactivity-timeout-ms NUMBER] --output FILE',
    '  reviewer-runner.mjs run-codex --model MODEL --prompt-file FILE --protocol brb-verification --expected-ids-file IDS.json --timeout-ms NUMBER [--inactivity-timeout-ms NUMBER] --output FILE',
  ].join('\n');
}

function readOptions(args) {
  const allowed = new Set([
    'prompt-file',
    'protocol',
    'angle',
    'expected-ids-file',
    'timeout-ms',
    'inactivity-timeout-ms',
    'output',
    'model',
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
    throw new TypeError('--timeout-ms must be an integer from 1 to 1800000');
  }
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1_800_000) {
    throw new TypeError('--timeout-ms must be an integer from 1 to 1800000');
  }
  return timeoutMs;
}

function inactivityTimeoutOption(value, timeoutMs) {
  if (!/^\d+$/.test(value)) {
    throw new TypeError('--inactivity-timeout-ms must be an integer from 1 through --timeout-ms');
  }
  const inactivityTimeoutMs = Number(value);
  if (!Number.isInteger(inactivityTimeoutMs)
    || inactivityTimeoutMs < 1
    || inactivityTimeoutMs > timeoutMs) {
    throw new TypeError('--inactivity-timeout-ms must be an integer from 1 through --timeout-ms');
  }
  return inactivityTimeoutMs;
}

function protocolValidator(protocol, angle, expectedIds) {
  const validators = {
    'brb-review': (value) => validateReviewResult(value, angle),
    'brb-reproduction': (value) => validateReproductionResult(value, expectedIds),
    'brb-verification': (value) => validateVerificationResult(value, expectedIds),
  };
  const validate = validators[protocol];
  if (!validate) throw new TypeError('--protocol is unsupported');
  if (protocol === 'brb-review' && angle === undefined) {
    throw new TypeError('--angle is required for brb-review');
  }
  if (protocol !== 'brb-review' && angle !== undefined) {
    throw new TypeError('--angle is supported only for brb-review');
  }
  if ((protocol === 'brb-reproduction' || protocol === 'brb-verification')
    && expectedIds === undefined) {
    throw new TypeError(`--expected-ids-file is required for ${protocol}`);
  }
  if (protocol === 'brb-review' && expectedIds !== undefined) {
    throw new TypeError('--expected-ids-file is not supported for brb-review');
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
  if (command !== 'run-claude' && command !== 'run-codex') throw new Error(usage());

  const options = readOptions(rest);
  const model = requireOption(options, 'model');
  const promptFile = requireOption(options, 'prompt-file');
  const protocol = requireOption(options, 'protocol');
  const angle = options.angle;
  const expectedIdsFile = options['expected-ids-file'];
  const output = requireOption(options, 'output');
  const timeoutMs = timeoutOption(requireOption(options, 'timeout-ms'));
  const inactivityTimeoutMs = options['inactivity-timeout-ms'] === undefined
    ? Math.min(300_000, timeoutMs)
    : inactivityTimeoutOption(options['inactivity-timeout-ms'], timeoutMs);
  const readFile = dependencies.readFile ?? readFileDefault;
  const writeFile = dependencies.writeFile ?? writeFileDefault;
  const launch = dependencies.launch ?? (command === 'run-codex'
    ? (launchOptions) => launchCodex(launchOptions, { model })
    : (launchOptions) => launchClaude(launchOptions, { model }));
  let expectedIds;
  if (protocol === 'brb-reproduction') {
    const path = requireOption(options, 'expected-ids-file');
    expectedIds = validateExpectedReproductionIds(parseJsonInput(
      await readFile(path, 'utf8'),
      path,
    ));
  } else if (protocol === 'brb-verification') {
    const path = requireOption(options, 'expected-ids-file');
    expectedIds = validateExpectedVerificationIds(parseJsonInput(
      await readFile(path, 'utf8'),
      path,
    ));
  } else if (expectedIdsFile !== undefined) {
    throw new TypeError('--expected-ids-file is not supported for brb-review');
  }
  const validate = protocolValidator(protocol, angle, expectedIds);
  const prompt = await readFile(promptFile, 'utf8');
  const result = await runReviewer({
    prompt,
    launch,
    validate,
    timeoutMs,
    inactivityTimeoutMs,
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
