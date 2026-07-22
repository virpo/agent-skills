import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  CLAUDE_REVIEW_ARGS,
  launchClaude,
  main,
  runReviewer,
} from '../skills/blast-radius-buddy/scripts/reviewer-runner.mjs';
import { parseProtocolBlock } from '../skills/blast-radius-buddy/scripts/review-protocol.mjs';

const COMPLETE_REVIEW = '```brb-review\n{"status":"complete","findings":[]}\n```';
const FEATURE_ANGLE = 'feature-truth-and-adjacent-regressions';
const REVIEW_PREFIX = join(tmpdir(), 'blast-radius-buddy-review-');

async function assertMissing(path) {
  await assert.rejects(access(path), (error) => error.code === 'ENOENT');
}

function fakeChild({ stdout = '', stderr = '', code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killedByTest = false;
  child.killSignals = [];
  child.kill = (signal) => {
    child.killedByTest = true;
    child.killSignals.push(signal);
    return true;
  };
  queueMicrotask(() => {
    child.stdout.end(stdout);
    child.stderr.end(stderr);
    child.emit('exit', code, null);
    child.emit('close', code, null);
  });
  return child;
}

function controlledChild(events, label) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.closedByTest = false;
  child.exitedByTest = false;
  let resolveTerm;
  let resolveKill;
  child.termSent = new Promise((resolve) => { resolveTerm = resolve; });
  child.killSent = new Promise((resolve) => { resolveKill = resolve; });
  child.kill = (signal) => {
    events.push(`${label}:${signal}`);
    if (signal === 'SIGTERM') resolveTerm();
    if (signal === 'SIGKILL') resolveKill();
    return true;
  };
  child.exit = (code = null, signal = 'SIGTERM') => {
    if (child.exitedByTest) return;
    child.exitedByTest = true;
    events.push(`${label}:exit`);
    child.emit('exit', code, signal);
  };
  child.close = (code = null, signal = 'SIGTERM') => {
    if (child.closedByTest) return;
    child.exit(code, signal);
    child.closedByTest = true;
    events.push(`${label}:close`);
    child.stdout.end();
    child.stderr.end();
    child.emit('close', code, signal);
  };
  return child;
}

test('runReviewer retries once in a different neutral directory', async () => {
  const calls = [];
  const result = await runReviewer({
    prompt: 'bounded packet with /private/target/path',
    launch: async (options) => {
      calls.push(options);
      return calls.length === 1 ? 'malformed' : COMPLETE_REVIEW;
    },
    validate: (output) => parseProtocolBlock(output, 'brb-review'),
  });

  assert.deepEqual(result, { status: 'complete', findings: [] });
  assert.equal(calls.length, 2);
  assert.equal(new Set(calls.map(({ cwd }) => cwd)).size, 2);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call).sort(), ['cwd', 'input', 'signal']);
    assert.ok(call.cwd.startsWith(REVIEW_PREFIX));
    assert.notEqual(call.cwd, process.cwd());
    assert.equal(call.input, 'bounded packet with /private/target/path');
    assert.equal(call.signal.aborted, false);
    await assertMissing(call.cwd);
  }
});

test('runReviewer never retries launch, authentication, permission, or model failures', async () => {
  for (const failure of [
    Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }),
    new Error('Claude exited with code 1: authentication failed'),
    new Error('Claude exited with code 1: permission denied'),
    new Error('Claude exited with code 1: model unavailable'),
  ]) {
    let attempts = 0;
    await assert.rejects(
      runReviewer({
        prompt: 'packet',
        launch: async () => {
          attempts += 1;
          throw failure;
        },
        validate: () => assert.fail('launch failures must not reach validation'),
      }),
      failure,
    );
    assert.equal(attempts, 1);
  }
});

test('runReviewer retries a non-string malformed response once', async () => {
  let attempts = 0;
  const result = await runReviewer({
    prompt: 'packet',
    launch: async () => {
      attempts += 1;
      return attempts === 1 ? null : COMPLETE_REVIEW;
    },
    validate: (output) => parseProtocolBlock(output, 'brb-review'),
  });

  assert.deepEqual(result, { status: 'complete', findings: [] });
  assert.equal(attempts, 2);
});

test('runReviewer uses a 420,000 ms default timeout', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const delays = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    delays.push(delay);
    return originalSetTimeout(callback, delay, ...args);
  };

  try {
    await runReviewer({
      prompt: 'packet',
      launch: async () => COMPLETE_REVIEW,
      validate: (output) => parseProtocolBlock(output, 'brb-review'),
      retries: 0,
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.deepEqual(delays, [420_000]);
});

test('runReviewer aborts a timed-out attempt and cleans its directory', async () => {
  let directory;
  let observedSignal;

  await assert.rejects(
    runReviewer({
      prompt: 'packet',
      timeoutMs: 1,
      retries: 0,
      launch: async ({ cwd, signal }) => {
        directory = cwd;
        observedSignal = signal;
        return new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              const error = new Error('external launcher honored abort');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        });
      },
      validate: () => assert.fail('validation must not run after timeout'),
    }),
    new Error('Reviewer timed out after 1 ms'),
  );

  assert.equal(observedSignal.aborted, true);
  await assertMissing(directory);
});

test('timeout waits for TERM, KILL, and child close before cleanup and retry', async () => {
  const events = [];
  const firstChild = controlledChild(events, 'first');
  const directories = [];
  let attempts = 0;
  let settled = false;

  const resultPromise = runReviewer({
    prompt: 'packet',
    timeoutMs: 2,
    retries: 1,
    launch: (options) => launchClaude(options, {
      termGraceMs: 5,
      killGuardMs: 100,
      spawnImpl: () => {
        attempts += 1;
        directories.push(options.cwd);
        events.push(`spawn:${attempts}`);
        return attempts === 1
          ? firstChild
          : fakeChild({ stdout: COMPLETE_REVIEW });
      },
    }),
    validate: (output) => parseProtocolBlock(output, 'brb-review'),
  });
  void resultPromise.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  try {
    await firstChild.termSent;
    await delay(12);
    assert.equal(settled, false);
    assert.equal(attempts, 1);
    assert.deepEqual(events, ['spawn:1', 'first:SIGTERM', 'first:SIGKILL']);
    await access(directories[0]);

    firstChild.exit(null, 'SIGKILL');
    await delay(0);
    assert.equal(settled, false);
    assert.equal(attempts, 1);
    assert.deepEqual(events, [
      'spawn:1', 'first:SIGTERM', 'first:SIGKILL', 'first:exit',
    ]);
    await access(directories[0]);

    firstChild.close(null, 'SIGKILL');
    assert.deepEqual(
      await resultPromise,
      { status: 'complete', findings: [] },
    );
    assert.deepEqual(events, [
      'spawn:1', 'first:SIGTERM', 'first:SIGKILL',
      'first:exit', 'first:close', 'spawn:2',
    ]);
    await assertMissing(directories[0]);
    await assertMissing(directories[1]);
  } finally {
    firstChild.close(null, 'SIGKILL');
    await resultPromise.catch(() => {});
  }
});

test('close after SIGTERM settles without sending SIGKILL', async () => {
  const events = [];
  const child = controlledChild(events, 'child');
  const controller = new AbortController();
  let settled = false;
  const launchPromise = launchClaude(
    { cwd: '/neutral/reviewer', input: 'packet', signal: controller.signal },
    { spawnImpl: () => child, termGraceMs: 20, killGuardMs: 20 },
  );
  void launchPromise.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  try {
    controller.abort();
    await child.termSent;
    await delay(0);
    assert.equal(settled, false);

    child.exit(null, 'SIGTERM');
    await delay(0);
    assert.equal(settled, false);
    child.close(null, 'SIGTERM');
    await assert.rejects(
      launchPromise,
      (error) => error.name === 'AbortError' && error.message === 'Claude review aborted',
    );
    await delay(30);
    assert.deepEqual(events, ['child:SIGTERM', 'child:exit', 'child:close']);
  } finally {
    child.close(null, 'SIGTERM');
    await launchPromise.catch(() => {});
  }
});

test('child error after a termination signal still waits for the close guard', async () => {
  const events = [];
  const child = controlledChild(events, 'child');
  const controller = new AbortController();
  let settled = false;
  const launchPromise = launchClaude(
    { cwd: '/neutral/reviewer', input: 'packet', signal: controller.signal },
    { spawnImpl: () => child, termGraceMs: 2, killGuardMs: 2 },
  );
  void launchPromise.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  controller.abort();
  await child.termSent;
  child.emit('error', new Error('signal delivery failed'));
  await delay(0);
  assert.equal(settled, false);

  await assert.rejects(
    launchPromise,
    (error) => error.name === 'UnterminatedReviewerChildError'
      && error.message === 'Claude child did not exit after SIGKILL',
  );
  assert.deepEqual(events, ['child:SIGTERM', 'child:SIGKILL']);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('close'), 0);
});

test('stdin EPIPE waits for close before cleanup and does not retry', async () => {
  const events = [];
  const child = controlledChild(events, 'child');
  const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  const directories = [];
  let attempts = 0;
  let firstLaunchPromise;
  let resolveSpawn;
  const spawned = new Promise((resolve) => { resolveSpawn = resolve; });
  let settled = false;

  const resultPromise = runReviewer({
    prompt: 'packet',
    timeoutMs: 1_000,
    retries: 1,
    launch: (options) => {
      attempts += 1;
      directories.push(options.cwd);
      events.push(`spawn:${attempts}`);
      if (attempts > 1) return Promise.resolve(COMPLETE_REVIEW);
      firstLaunchPromise = launchClaude(options, {
        termGraceMs: 100,
        killGuardMs: 100,
        spawnImpl: () => {
          resolveSpawn();
          return child;
        },
      });
      return firstLaunchPromise;
    },
    validate: (output) => parseProtocolBlock(output, 'brb-review'),
  });
  void resultPromise.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  try {
    await spawned;
    const firstOutcome = firstLaunchPromise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    child.stdin.emit('error', epipe);
    await delay(0);

    assert.equal(settled, false);
    assert.equal(attempts, 1);
    assert.equal(child.listenerCount('close'), 1);
    assert.deepEqual(events, ['spawn:1', 'child:SIGTERM']);
    await access(directories[0]);

    await child.termSent;
    child.close(null, 'SIGTERM');
    assert.deepEqual(await firstOutcome, { error: epipe });
    await assert.rejects(resultPromise, epipe);
    assert.equal(attempts, 1);
    assert.deepEqual(events, ['spawn:1', 'child:SIGTERM', 'child:exit', 'child:close']);
    await assertMissing(directories[0]);
  } finally {
    child.close(null, 'SIGTERM');
    await resultPromise.catch(() => {});
  }
});

test('stdin EPIPE remains first cause when outer timeout fires before close', async () => {
  const events = [];
  const child = controlledChild(events, 'first');
  const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  const directories = [];
  const signals = [];
  let resolveSpawn;
  const spawned = new Promise((resolve) => { resolveSpawn = resolve; });
  let attempts = 0;

  const resultPromise = runReviewer({
    prompt: 'packet',
    timeoutMs: 5,
    retries: 1,
    launch: (options) => {
      attempts += 1;
      directories.push(options.cwd);
      signals.push(options.signal);
      if (attempts > 1) return Promise.resolve(COMPLETE_REVIEW);
      return launchClaude(options, {
        termGraceMs: 100,
        killGuardMs: 100,
        spawnImpl: () => {
          resolveSpawn();
          return child;
        },
      });
    },
    validate: () => assert.fail('EPIPE output must not be validated'),
  });
  const resultOutcome = resultPromise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );

  try {
    await spawned;
    child.stdin.emit('error', epipe);
    await child.termSent;
    await delay(10);

    assert.equal(signals[0].aborted, true);
    assert.equal(child.listenerCount('close'), 1);
    assert.deepEqual(events, ['first:SIGTERM']);
    await access(directories[0]);

    child.close(null, 'SIGTERM');

    const outcome = await resultOutcome;
    assert.equal(outcome.error, epipe);
    assert.equal(attempts, 1);
    assert.deepEqual(events, ['first:SIGTERM', 'first:exit', 'first:close']);
    await assertMissing(directories[0]);
  } finally {
    child.close(null, 'SIGTERM');
    await resultOutcome;
  }
});

test('unterminated stdin EPIPE prevents retry and preserves its cwd', async () => {
  const events = [];
  const child = controlledChild(events, 'child');
  const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  let attempts = 0;
  let firstDirectory;
  let resolveSpawn;
  const spawned = new Promise((resolve) => { resolveSpawn = resolve; });
  const resultPromise = runReviewer({
    prompt: 'packet',
    timeoutMs: 1_000,
    retries: 1,
    launch: (options) => {
      attempts += 1;
      if (attempts > 1) return Promise.resolve(COMPLETE_REVIEW);
      firstDirectory = options.cwd;
      return launchClaude(options, {
        termGraceMs: 2,
        killGuardMs: 2,
        spawnImpl: () => {
          resolveSpawn();
          return child;
        },
      });
    },
    validate: (output) => parseProtocolBlock(output, 'brb-review'),
  });

  try {
    await spawned;
    child.stdin.emit('error', epipe);
    await assert.rejects(
      resultPromise,
      (error) => error.name === 'UnterminatedReviewerChildError'
        && error.message === 'Claude child did not exit after SIGKILL',
    );
    assert.equal(attempts, 1);
    assert.deepEqual(events, ['child:SIGTERM', 'child:SIGKILL']);
    await access(firstDirectory);
  } finally {
    if (typeof firstDirectory === 'string' && firstDirectory.startsWith(REVIEW_PREFIX)) {
      await rm(firstDirectory, { recursive: true, force: true });
    }
  }
});

test('unterminated child after SIGKILL prevents retry and preserves its cwd', async () => {
  const events = [];
  const firstChild = controlledChild(events, 'child');
  let attempts = 0;
  let directory;

  const resultPromise = runReviewer({
    prompt: 'packet',
    timeoutMs: 1,
    retries: 1,
    launch: (options) => {
      attempts += 1;
      directory = options.cwd;
      return attempts === 1
        ? launchClaude(options, {
          spawnImpl: () => firstChild,
          termGraceMs: 2,
          killGuardMs: 2,
        })
        : Promise.resolve(COMPLETE_REVIEW);
    },
    validate: (output) => parseProtocolBlock(output, 'brb-review'),
  });

  try {
    await assert.rejects(
      resultPromise,
      (error) => error.name === 'UnterminatedReviewerChildError'
        && error.message === 'Claude child did not exit after SIGKILL',
    );
    assert.equal(attempts, 1);
    assert.deepEqual(events, ['child:SIGTERM', 'child:SIGKILL']);
    await access(directory);
  } finally {
    if (typeof directory === 'string' && directory.startsWith(REVIEW_PREFIX)) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('runReviewer propagates the second failure and cleans both attempts', async () => {
  const directories = [];
  let validations = 0;
  const failure = new Error('invalid reviewer output');

  await assert.rejects(
    runReviewer({
      prompt: 'packet',
      launch: async ({ cwd }) => {
        directories.push(cwd);
        return 'malformed';
      },
      validate: () => {
        validations += 1;
        throw failure;
      },
    }),
    failure,
  );

  assert.equal(validations, 2);
  assert.equal(new Set(directories).size, 2);
  for (const directory of directories) await assertMissing(directory);
});

test('runReviewer validates inputs before creating or launching an attempt', async () => {
  let launches = 0;
  const launch = async () => {
    launches += 1;
    return COMPLETE_REVIEW;
  };
  const validate = (output) => output;
  const invalid = [
    { prompt: '', launch, validate },
    { prompt: '  ', launch, validate },
    { prompt: 'packet', launch: null, validate },
    { prompt: 'packet', launch, validate: null },
    { prompt: 'packet', launch, validate, timeoutMs: 0 },
    { prompt: 'packet', launch, validate, timeoutMs: 600_001 },
    { prompt: 'packet', launch, validate, retries: 2 },
  ];

  for (const options of invalid) await assert.rejects(runReviewer(options), TypeError);
  assert.equal(launches, 0);
});

test('launchClaude uses fixed arguments, minimal environment, and stdin prompt bytes', async () => {
  const calls = [];
  let stdin = '';
  let resolveInput;
  const inputEnded = new Promise((resolve) => { resolveInput = resolve; });
  const spawnImpl = (command, args, options) => {
    const child = fakeChild({ stdout: 'normalized output', stderr: 'diagnostic' });
    child.stdin.on('data', (chunk) => { stdin += chunk.toString(); });
    child.stdin.on('end', resolveInput);
    calls.push({ command, args, options });
    return child;
  };

  const output = await launchClaude(
    { cwd: '/neutral/reviewer', input: 'prompt bytes ; $(never)', signal: new AbortController().signal },
    { spawnImpl },
  );
  await inputEnded;

  assert.equal(output, 'normalized output');
  assert.equal(stdin, 'prompt bytes ; $(never)');
  assert.deepEqual(calls[0].command, 'claude');
  assert.deepEqual(calls[0].args, CLAUDE_REVIEW_ARGS);
  assert.equal(calls[0].args.includes('prompt bytes ; $(never)'), false);
  assert.equal(calls[0].options.cwd, '/neutral/reviewer');
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(
    Object.keys(calls[0].options.env).sort(),
    Object.keys(process.env)
      .filter((key) => [
        'PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL',
        'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN',
      ].includes(key))
      .sort(),
  );
});

test('launchClaude rejects output beyond the combined 10 MiB cap', async () => {
  let child;
  await assert.rejects(
    launchClaude(
      { cwd: '/neutral/reviewer', input: 'packet', signal: new AbortController().signal },
      {
        spawnImpl: () => {
          child = fakeChild({ stdout: Buffer.alloc(10 * 1024 * 1024 + 1, 97) });
          return child;
        },
      },
    ),
    (error) => error.name === 'ReviewerOutputLimitError'
      && error.message === 'Claude output exceeded 10 MiB capture limit',
  );
  assert.equal(child.killedByTest, true);
});

test('output cap waits through child exit for close before cleanup', async () => {
  const events = [];
  const child = controlledChild(events, 'child');
  let directory;
  let resolveSpawn;
  const spawned = new Promise((resolve) => { resolveSpawn = resolve; });
  let settled = false;
  const resultPromise = runReviewer({
    prompt: 'packet',
    timeoutMs: 1_000,
    retries: 0,
    launch: (options) => {
      directory = options.cwd;
      return launchClaude(options, {
        killGuardMs: 100,
        spawnImpl: () => {
          resolveSpawn();
          return child;
        },
      });
    },
    validate: () => assert.fail('over-limit output must not be validated'),
  });
  void resultPromise.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  try {
    await spawned;
    child.stdout.write(Buffer.alloc(10 * 1024 * 1024 + 1, 97));
    await child.killSent;
    child.stdin.emit(
      'error',
      Object.assign(new Error('late write EPIPE'), { code: 'EPIPE' }),
    );
    await delay(0);
    assert.equal(settled, false);
    assert.deepEqual(events, ['child:SIGKILL']);
    await access(directory);

    child.exit(null, 'SIGKILL');
    await delay(0);
    assert.equal(settled, false);
    assert.deepEqual(events, ['child:SIGKILL', 'child:exit']);
    await access(directory);

    child.close(null, 'SIGKILL');
    await assert.rejects(
      resultPromise,
      (error) => error.name === 'ReviewerOutputLimitError'
        && error.message === 'Claude output exceeded 10 MiB capture limit',
    );
    await assertMissing(directory);
  } finally {
    child.close(null, 'SIGKILL');
    await resultPromise.catch(() => {});
  }
});

test('unterminated output-cap child prevents retry and preserves its cwd', async () => {
  const events = [];
  const child = controlledChild(events, 'child');
  let attempts = 0;
  let directory;
  let resolveSpawn;
  const spawned = new Promise((resolve) => { resolveSpawn = resolve; });
  const resultPromise = runReviewer({
    prompt: 'packet',
    timeoutMs: 1_000,
    retries: 1,
    launch: (options) => {
      attempts += 1;
      directory = options.cwd;
      if (attempts > 1) return Promise.resolve(COMPLETE_REVIEW);
      return launchClaude(options, {
        killGuardMs: 2,
        spawnImpl: () => {
          resolveSpawn();
          return child;
        },
      });
    },
    validate: (output) => parseProtocolBlock(output, 'brb-review'),
  });

  try {
    await spawned;
    child.stdout.write(Buffer.alloc(10 * 1024 * 1024 + 1, 97));
    await assert.rejects(
      resultPromise,
      (error) => error.name === 'UnterminatedReviewerChildError'
        && error.message === 'Claude child did not exit after SIGKILL',
    );
    assert.equal(attempts, 1);
    assert.deepEqual(events, ['child:SIGKILL']);
    await access(directory);
  } finally {
    if (typeof directory === 'string' && directory.startsWith(REVIEW_PREFIX)) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('run-claude CLI retries once and writes only normalized validated JSON', async () => {
  const writes = [];
  let launches = 0;

  await main(
    [
      'run-claude',
      '--prompt-file', './packet.md',
      '--protocol', 'brb-review',
      '--angle', FEATURE_ANGLE,
      '--timeout-ms', '25',
      '--output', './review.json',
    ],
    {
      readFile: async (path, encoding) => {
        assert.deepEqual([path, encoding], ['./packet.md', 'utf8']);
        return 'bounded packet';
      },
      launch: async ({ input }) => {
        launches += 1;
        assert.equal(input, 'bounded packet');
        return launches === 1 ? 'malformed' : COMPLETE_REVIEW;
      },
      writeFile: async (...args) => writes.push(args),
    },
  );

  assert.equal(launches, 2);
  assert.deepEqual(writes, [[
    './review.json',
    '{"status":"complete","findings":[]}\n',
    'utf8',
  ]]);
});

test('run-claude CLI requires an assigned angle for first-pass review validation', async () => {
  let launches = 0;

  await assert.rejects(
    main(
      [
        'run-claude',
        '--prompt-file', './packet.md',
        '--protocol', 'brb-review',
        '--timeout-ms', '25',
        '--output', './review.json',
      ],
      {
        readFile: async () => 'bounded packet',
        launch: async () => {
          launches += 1;
          return COMPLETE_REVIEW;
        },
      },
    ),
    /--angle is required/,
  );
  assert.equal(launches, 0);
});
