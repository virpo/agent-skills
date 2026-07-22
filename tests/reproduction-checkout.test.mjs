import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  applyProcessExitCode,
  main,
  withReproductionCheckout,
} from '../skills/blast-radius-buddy/scripts/reproduction-checkout.mjs';

const REPRODUCTION_PREFIX = join(tmpdir(), 'blast-radius-buddy-reproduction-');
const execFileAsync = promisify(execFile);

test('classify results do not become an invalid process exit code', () => {
  const processObject = {};

  applyProcessExitCode({ results: [] }, processObject);
  assert.equal(processObject.exitCode, undefined);

  applyProcessExitCode(7, processObject);
  assert.equal(processObject.exitCode, 7);
});

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

test('classify runs selected diagnostics in a detached checkout then classifies captured evidence', async (t) => {
  const repository = await mkdtemp(join(tmpdir(), 'brb-selected-reproduction-'));
  t.after(() => rm(repository, { recursive: true, force: true }));
  await execFileAsync('git', ['init', repository]);
  await execFileAsync('git', ['-C', repository, 'config', 'user.email', 'test@example.com']);
  await execFileAsync('git', ['-C', repository, 'config', 'user.name', 'Test']);
  await writeFile(join(repository, 'fixture.txt'), 'selected evidence\n', 'utf8');
  await execFileAsync('git', ['-C', repository, 'add', 'fixture.txt']);
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'fixture']);
  const { stdout: headSha } = await execFileAsync('git', ['-C', repository, 'rev-parse', 'HEAD']);
  const promptFile = join(repository, 'prompt.md');
  const expectedIdsFile = join(repository, 'expected-ids.json');
  const evidenceOutput = join(repository, 'evidence.json');
  const output = join(repository, 'reproduction.json');
  await writeFile(promptFile, 'Classify only BRB001.', 'utf8');
  await writeFile(expectedIdsFile, '["BRB001"]', 'utf8');
  let classifierPrompt;

  await main([
    'classify',
    '--repository', repository,
    '--head-sha', headSha.trim(),
    '--prompt-file', promptFile,
    '--expected-ids-file', expectedIdsFile,
    '--evidence-output', evidenceOutput,
    '--output', output,
    '--', process.execPath, '-e', "process.stdout.write(require('fs').readFileSync('fixture.txt'))",
  ], {
    launchReviewer: async ({ input }) => {
      classifierPrompt = input;
      return '```brb-reproduction\n{"results":[{"id":"BRB001","verdict":"confirmed","severity":"medium","evidence":"diagnostic printed selected evidence","reason":"The selected command observed the expected fixture.","reportEffect":"actionable"}]}\n```';
    },
  });

  const evidence = JSON.parse(await readFile(evidenceOutput, 'utf8'));
  assert.deepEqual(evidence, {
    command: process.execPath,
    args: ['-e', "process.stdout.write(require('fs').readFileSync('fixture.txt'))"],
    exitCode: 0,
    stdout: 'selected evidence\n',
    stderr: '',
  });
  assert.match(classifierPrompt, /Classify only BRB001\./);
  assert.match(classifierPrompt, /Host-captured diagnostic evidence/);
  assert.match(classifierPrompt, /selected evidence/);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
    results: [{
      id: 'BRB001',
      verdict: 'confirmed',
      severity: 'medium',
      evidence: 'diagnostic printed selected evidence',
      reason: 'The selected command observed the expected fixture.',
      reportEffect: 'actionable',
    }],
  });
  const { stdout: worktrees } = await execFileAsync('git', [
    '-C', repository, 'worktree', 'list', '--porcelain',
  ]);
  assert.equal(worktrees.includes(REPRODUCTION_PREFIX), false);
});

test('classify rejects diagnostic evidence beyond the bounded capture before reviewer launch', async () => {
  let launches = 0;
  const execute = recordingExecute([
    { stdout: '' },
    { stdout: '' },
    { stdout: '' },
  ]);

  await assert.rejects(
    main([
      'classify',
      '--repository', '/repo',
      '--head-sha', 'abcdef0',
      '--prompt-file', 'prompt.md',
      '--expected-ids-file', 'ids.json',
      '--evidence-output', 'evidence.json',
      '--output', 'result.json',
      '--', 'diagnostic',
    ], {
      execute,
      readFile: async (path) => path === 'ids.json' ? '["BRB001"]' : 'classify BRB001',
      captureCommand: async () => ({
        command: 'diagnostic',
        args: [],
        exitCode: 0,
        stdout: 'x'.repeat(10 * 1024 * 1024 + 1),
        stderr: '',
      }),
      launchReviewer: async () => {
        launches += 1;
        throw new Error('must not launch');
      },
      writeFile: async () => {},
    }),
    /diagnostic output exceeded 10 MiB capture limit/i,
  );
  assert.equal(launches, 0);
});

test('classify supplies the production isolated launcher when no classifier launcher is injected', async () => {
  const execute = recordingExecute([
    { stdout: '' },
    { stdout: '' },
    { stdout: '' },
  ]);
  let observedLaunch;

  await main([
    'classify',
    '--repository', '/repo',
    '--head-sha', 'abcdef0',
    '--prompt-file', 'prompt.md',
    '--expected-ids-file', 'ids.json',
    '--evidence-output', 'evidence.json',
    '--output', 'result.json',
    '--', 'diagnostic',
  ], {
    execute,
    readFile: async (path) => path === 'ids.json' ? '["BRB001"]' : 'classify BRB001',
    captureCommand: async () => ({
      command: 'diagnostic', args: [], exitCode: 0, stdout: 'proof', stderr: '',
    }),
    runReviewer: async ({ launch }) => {
      observedLaunch = launch;
      return { results: [] };
    },
    writeFile: async () => {},
  });

  assert.equal(typeof observedLaunch, 'function');
});
