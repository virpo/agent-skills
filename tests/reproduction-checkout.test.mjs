import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  main,
  withReproductionCheckout,
} from '../skills/blast-radius-buddy/scripts/reproduction-checkout.mjs';

const REPRODUCTION_PREFIX = join(tmpdir(), 'blast-radius-buddy-reproduction-');

function recordingExecute(responses) {
  const calls = [];
  let index = 0;
  const execute = async (command, args) => {
    calls.push([command, args]);
    const response = responses[index++];
    assert.notEqual(response, undefined, `unexpected command: ${command} ${args.join(' ')}`);
    if (response instanceof Error) throw response;
    return response;
  };
  execute.calls = calls;
  return execute;
}

async function assertMissing(path) {
  await assert.rejects(access(path), (error) => error.code === 'ENOENT');
}

test('withReproductionCheckout adds a detached worktree and removes exactly that path', async () => {
  const execute = recordingExecute([{ stdout: '' }, { stdout: '' }]);
  let inspectedPath;

  const result = await withReproductionCheckout({
    repository: '/repo',
    headSha: 'abcdef0',
    execute,
    inspect: async (checkoutPath) => {
      inspectedPath = checkoutPath;
      assert.ok(checkoutPath.startsWith(REPRODUCTION_PREFIX));
      assert.notEqual(checkoutPath, '/repo');
      return 'reproduced';
    },
  });

  assert.equal(result, 'reproduced');
  assert.deepEqual(execute.calls, [
    ['git', ['-C', '/repo', 'worktree', 'add', '--detach', inspectedPath, 'abcdef0']],
    ['git', ['-C', '/repo', 'worktree', 'remove', '--force', inspectedPath]],
  ]);
  await assertMissing(inspectedPath);
});

test('withReproductionCheckout removes the detached worktree when inspection throws', async () => {
  const execute = recordingExecute([{ stdout: '' }, { stdout: '' }]);
  const failure = new Error('reproduction failed');
  let checkoutPath;

  await assert.rejects(
    withReproductionCheckout({
      repository: '/repo',
      headSha: 'abcdef0',
      execute,
      inspect: async (path) => {
        checkoutPath = path;
        throw failure;
      },
    }),
    failure,
  );

  assert.deepEqual(execute.calls.at(-1), [
    'git', ['-C', '/repo', 'worktree', 'remove', '--force', checkoutPath],
  ]);
  await assertMissing(checkoutPath);
});

test('withReproductionCheckout rejects invalid inputs before invoking git', async () => {
  const invalid = [
    { repository: '', headSha: 'abcdef0', inspect: async () => {} },
    { repository: '   ', headSha: 'abcdef0', inspect: async () => {} },
    { repository: '/repo', headSha: 'not-hex', inspect: async () => {} },
    { repository: '/repo', headSha: 'abcdef', inspect: async () => {} },
    { repository: '/repo', headSha: 'abcdef0', inspect: null },
  ];

  for (const options of invalid) {
    const execute = recordingExecute([]);
    await assert.rejects(withReproductionCheckout({ ...options, execute }), TypeError);
    assert.deepEqual(execute.calls, []);
  }
});

test('run command preserves argument boundaries and forwards a clean child exit code', async () => {
  const execute = recordingExecute([
    { stdout: '' },
    { stdout: '' },
    { stdout: '' },
  ]);
  const launches = [];
  const exitCode = await main(
    [
      'run', '--repository', '/repo', '--head-sha', 'abcdef0', '--',
      'tool name', 'argument with spaces', '; touch never', '$(touch never)',
    ],
    {
      execute,
      launchCommand: async (command, args, options) => {
        launches.push({ command, args, options });
        return 7;
      },
    },
  );

  const checkoutPath = execute.calls[0][1][5];
  assert.equal(exitCode, 7);
  assert.deepEqual(launches, [{
    command: 'tool name',
    args: ['argument with spaces', '; touch never', '$(touch never)'],
    options: { cwd: checkoutPath, shell: false },
  }]);
  assert.deepEqual(execute.calls, [
    ['git', ['-C', '/repo', 'worktree', 'add', '--detach', checkoutPath, 'abcdef0']],
    ['git', ['-C', checkoutPath, 'status', '--porcelain']],
    ['git', ['-C', '/repo', 'worktree', 'remove', '--force', checkoutPath]],
  ]);
  await assertMissing(checkoutPath);
});

test('run command rejects a dirty reproduction and still removes the worktree', async () => {
  const execute = recordingExecute([
    { stdout: '' },
    { stdout: ' M tracked-file\n' },
    { stdout: '' },
  ]);
  let checkoutPath;

  await assert.rejects(
    main(
      ['run', '--repository', '/repo', '--head-sha', 'abcdef0', '--', 'tool'],
      {
        execute,
        launchCommand: async (_command, _args, options) => {
          checkoutPath = options.cwd;
          return 0;
        },
      },
    ),
    new Error('Reproduction modified the detached checkout'),
  );

  assert.deepEqual(execute.calls.at(-1), [
    'git', ['-C', '/repo', 'worktree', 'remove', '--force', checkoutPath],
  ]);
  await assertMissing(checkoutPath);
});

test('run command requires a command token after the separator before invoking git', async () => {
  const invalidArgs = [
    ['run', '--repository', '/repo', '--head-sha', 'abcdef0'],
    ['run', '--repository', '/repo', '--head-sha', 'abcdef0', '--'],
  ];

  for (const args of invalidArgs) {
    const execute = recordingExecute([]);
    await assert.rejects(main(args, { execute }));
    assert.deepEqual(execute.calls, []);
  }
});
