import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  CLAUDE_REVIEW_ARGS,
  launchClaude,
  main,
  runReviewer,
} from '../skills/blast-radius-buddy/scripts/reviewer-runner.mjs';
import { parseProtocolBlock } from '../skills/blast-radius-buddy/scripts/review-protocol.mjs';

const COMPLETE_REVIEW = '```brb-review\n{"status":"complete","findings":[]}\n```';
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
  child.kill = () => {
    child.killedByTest = true;
    return true;
  };
  queueMicrotask(() => {
    child.stdout.end(stdout);
    child.stderr.end(stderr);
    child.emit('close', code, null);
  });
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
        return new Promise(() => {});
      },
      validate: () => assert.fail('validation must not run after timeout'),
    }),
    new Error('Reviewer timed out after 1 ms'),
  );

  assert.equal(observedSignal.aborted, true);
  await assertMissing(directory);
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
    new Error('Claude output exceeded 10 MiB capture limit'),
  );
  assert.equal(child.killedByTest, true);
});

test('run-claude CLI retries once and writes only normalized validated JSON', async () => {
  const writes = [];
  let launches = 0;

  await main(
    [
      'run-claude',
      '--prompt-file', './packet.md',
      '--protocol', 'brb-review',
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
