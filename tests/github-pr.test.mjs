import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  StaleHeadError,
  assertHeadUnchanged,
  main,
  resolvePullRequest,
} from '../skills/blast-radius-buddy/scripts/github-pr.mjs';
import { fakeExecute } from './helpers/fake-execute.mjs';

const execFileAsync = promisify(execFile);
const PR_FIELDS = [
  'number', 'url', 'title', 'body', 'baseRefOid', 'headRefOid',
  'author', 'files', 'statusCheckRollup', 'headRepositoryOwner',
].join(',');
const PR_VIEW = {
  number: 19,
  url: 'https://github.com/acme/widget/pull/19',
  title: 'Keep authorization cache entries bounded',
  body: 'Preserve authorization results for five minutes.',
  author: { login: 'contributor' },
  baseRefOid: '1111111111111111111111111111111111111111',
  headRefOid: '2222222222222222222222222222222222222222',
  files: [{ path: 'src/cache.ts', additions: 8, deletions: 2 }],
  statusCheckRollup: [
    { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', isRequired: true },
    { context: 'lint', state: 'FAILURE', isRequired: false },
    { name: 'deploy', status: 'IN_PROGRESS' },
    { name: 'optional preview', status: 'COMPLETED', conclusion: 'SKIPPED' },
  ],
};
const RESOLVED_PR = {
  repo: 'acme/widget',
  number: 19,
  url: PR_VIEW.url,
  title: PR_VIEW.title,
  body: PR_VIEW.body,
  authorLogin: 'contributor',
  baseSha: '1111111111111111111111111111111111111111',
  headSha: '2222222222222222222222222222222222222222',
  files: PR_VIEW.files,
  checks: [
    { name: 'test', state: 'pass', required: true },
    { name: 'lint', state: 'fail', required: false },
    { name: 'deploy', state: 'pending', required: false },
    { name: 'optional preview', state: 'neutral', required: false },
  ],
};

test('resolvePullRequest accepts a PR URL without consulting the current repo', async () => {
  const execute = fakeExecute([{ stdout: JSON.stringify(PR_VIEW) }]);

  const result = await resolvePullRequest({
    target: 'https://github.com/acme/widget/pull/19',
    execute,
  });

  assert.deepEqual(result, RESOLVED_PR);
  assert.equal(execute.calls.length, 1);
  assert.deepEqual(execute.calls[0], {
    command: 'gh',
    args: ['pr', 'view', PR_VIEW.url, '--repo', 'acme/widget', '--json', PR_FIELDS],
    options: {},
  });
});

test('resolvePullRequest resolves a numeric target against the current repository', async () => {
  const execute = fakeExecute([
    { stdout: JSON.stringify({ nameWithOwner: 'acme/widget' }) },
    { stdout: JSON.stringify(PR_VIEW) },
  ]);

  const result = await resolvePullRequest({ target: '19', execute });

  assert.equal(result.repo, 'acme/widget');
  assert.deepEqual(execute.calls.map(({ command, args }) => ({ command, args })), [
    { command: 'gh', args: ['repo', 'view', '--json', 'nameWithOwner'] },
    {
      command: 'gh',
      args: ['pr', 'view', '19', '--repo', 'acme/widget', '--json', PR_FIELDS],
    },
  ]);
});

test('resolvePullRequest uses the current branch when the target is omitted', async () => {
  const execute = fakeExecute([
    { stdout: JSON.stringify({ nameWithOwner: 'acme/widget' }) },
    { stdout: JSON.stringify(PR_VIEW) },
  ]);

  await resolvePullRequest({ execute });

  assert.deepEqual(execute.calls[1].args, [
    'pr', 'view', '--repo', 'acme/widget', '--json', PR_FIELDS,
  ]);
});

test('resolvePullRequest rejects malformed targets before invoking gh', async () => {
  const execute = fakeExecute([]);

  await assert.rejects(
    resolvePullRequest({ target: 'https://example.com/acme/widget/pull/19', execute }),
    new TypeError('target must be a GitHub PR URL, positive PR number, or omitted'),
  );
  assert.equal(execute.calls.length, 0);
});

test('resolvePullRequest rejects non-safe standalone PR numbers before invoking gh', async () => {
  const invalidTargets = [
    '0',
    '9007199254740992',
    '9007199254740993',
    '9'.repeat(400),
  ];

  for (const target of invalidTargets) {
    const execute = fakeExecute([]);
    await assert.rejects(
      resolvePullRequest({ target, execute }),
      new TypeError('target must be a GitHub PR URL, positive PR number, or omitted'),
    );
    assert.equal(execute.calls.length, 0);
  }
});

test('resolvePullRequest rejects non-safe URL PR numbers before invoking gh', async () => {
  const invalidNumbers = [
    '0',
    '9007199254740992',
    '9007199254740993',
    '9'.repeat(400),
  ];

  for (const number of invalidNumbers) {
    const execute = fakeExecute([]);
    await assert.rejects(
      resolvePullRequest({
        target: `https://github.com/acme/widget/pull/${number}`,
        execute,
      }),
      new TypeError('target must be a GitHub PR URL, positive PR number, or omitted'),
    );
    assert.equal(execute.calls.length, 0);
  }
});

test('assertHeadUnchanged throws a typed stale-head error', async () => {
  const execute = fakeExecute([{ stdout: JSON.stringify({ headRefOid: '2222222' }) }]);

  await assert.rejects(
    assertHeadUnchanged({
      repo: 'acme/widget',
      number: 19,
      expectedHeadSha: '1111111',
      execute,
    }),
    (error) => error instanceof StaleHeadError
      && error.name === 'StaleHeadError'
      && error.expectedHeadSha === '1111111'
      && error.actualHeadSha === '2222222',
  );
  assert.deepEqual(execute.calls[0].args, [
    'pr', 'view', '19', '--repo', 'acme/widget', '--json', 'headRefOid',
  ]);
});

test('assertHeadUnchanged returns the exact matching head SHA', async () => {
  const headSha = '2222222222222222222222222222222222222222';
  const execute = fakeExecute([{ stdout: JSON.stringify({ headRefOid: headSha }) }]);

  assert.equal(await assertHeadUnchanged({
    repo: 'acme/widget',
    number: 19,
    expectedHeadSha: headSha,
    execute,
  }), headSha);
});

test('main prints JSON for both read-only commands', async () => {
  const outputs = [];
  const resolveExecute = fakeExecute([{ stdout: JSON.stringify(PR_VIEW) }]);

  await main(
    ['resolve', '--target', PR_VIEW.url],
    { execute: resolveExecute, writeStdout: (value) => outputs.push(value) },
  );

  const checkExecute = fakeExecute([
    { stdout: JSON.stringify({ headRefOid: PR_VIEW.headRefOid }) },
  ]);
  await main(
    [
      'check-head',
      '--repo', 'acme/widget',
      '--pr', '19',
      '--expected-sha', PR_VIEW.headRefOid,
    ],
    { execute: checkExecute, writeStdout: (value) => outputs.push(value) },
  );

  assert.deepEqual(outputs, [
    `${JSON.stringify(RESOLVED_PR)}\n`,
    `${JSON.stringify(PR_VIEW.headRefOid)}\n`,
  ]);
});

test('check-head validates every CLI input before invoking gh', async () => {
  const invalidCases = [
    {
      args: ['--repo', 'acme', '--pr', '19', '--expected-sha', 'abcdef0'],
      error: new TypeError('repo must use OWNER/REPO format'),
    },
    {
      args: ['--repo', 'acme/widget', '--pr', '0', '--expected-sha', 'abcdef0'],
      error: new TypeError('pr must be a positive safe integer'),
    },
    {
      args: [
        '--repo', 'acme/widget',
        '--pr', '9007199254740993',
        '--expected-sha', 'abcdef0',
      ],
      error: new TypeError('pr must be a positive safe integer'),
    },
    {
      args: [
        '--repo', 'acme/widget',
        '--pr', '9'.repeat(400),
        '--expected-sha', 'abcdef0',
      ],
      error: new TypeError('pr must be a positive safe integer'),
    },
    {
      args: ['--repo', 'acme/widget', '--pr', '19', '--expected-sha', 'abcdef'],
      error: new TypeError('expected-sha must be a 7-64 character hexadecimal commit id'),
    },
    {
      args: ['--repo', 'acme/widget', '--pr', '19', '--expected-sha', 'g234567'],
      error: new TypeError('expected-sha must be a 7-64 character hexadecimal commit id'),
    },
    {
      args: ['--repo', 'acme/widget', '--pr', '19', '--expected-sha', 'a'.repeat(65)],
      error: new TypeError('expected-sha must be a 7-64 character hexadecimal commit id'),
    },
  ];

  for (const { args, error } of invalidCases) {
    const execute = fakeExecute([]);
    await assert.rejects(main(['check-head', ...args], { execute }), error);
    assert.equal(execute.calls.length, 0);
  }
});

test('the executable prints exact errors on stderr', async () => {
  const script = fileURLToPath(
    new URL('../skills/blast-radius-buddy/scripts/github-pr.mjs', import.meta.url),
  );

  await assert.rejects(
    execFileAsync(process.execPath, [script, 'resolve', '--target', 'not-a-pr']),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.equal(
        error.stderr,
        'target must be a GitHub PR URL, positive PR number, or omitted\n',
      );
      return true;
    },
  );
});
