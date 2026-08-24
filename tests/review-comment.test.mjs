import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  buildCompletionBody,
  buildFailureBody,
  buildFinalBody,
  buildIncompleteBody,
  buildProgressBody,
  buildRetryBody,
  buildStaleBody,
  findMarkerComment,
  main,
  upsertReviewComment,
} from '../skills/blast-radius-buddy/scripts/review-comment.mjs';

const NEW_MARKER = '<!-- blast-radius-buddy -->';
const LEGACY_MARKER = '<!-- review-tube-man -->';

function fakeExecute(responses) {
  const calls = [];
  let index = 0;

  return {
    calls,
    execute: async (command, args) => {
      calls.push({ command, args });
      const response = responses[index++];
      assert.notEqual(response, undefined, `unexpected command: ${command} ${args.join(' ')}`);
      return { stdout: JSON.stringify(response), stderr: '' };
    },
  };
}

test('findMarkerComment returns the marker comment', () => {
  const markerComment = { id: 22, body: `Review running\n\n${NEW_MARKER}` };
  const comments = [
    { id: 11, body: 'Unrelated review' },
    markerComment,
    { id: 33, body: null },
  ];

  assert.equal(findMarkerComment(comments), markerComment);
  assert.equal(findMarkerComment([{ id: 11, body: 'No marker' }]), undefined);
});

test('findMarkerComment recognizes the legacy Review Tube Man marker', () => {
  const legacyComment = { id: 22, body: `Review running\n\n${LEGACY_MARKER}` };

  assert.equal(findMarkerComment([legacyComment]), legacyComment);
});

test('findMarkerComment prefers the Blast Radius Buddy marker during migration', () => {
  const legacyComment = { id: 11, body: `Old review\n\n${LEGACY_MARKER}` };
  const currentComment = { id: 22, body: `Current review\n\n${NEW_MARKER}` };

  assert.equal(findMarkerComment([legacyComment, currentComment]), currentComment);
});

test('buildProgressBody uses one small branded title and one working sentence', () => {
  assert.equal(
    buildProgressBody({ headSha: 'abcdef012345', completedStages: ['review'] }),
    [
      '### 🧨 Blast Radius Buddy',
      '',
      'Checking this PR now. Be right back.',
      '',
      '<!-- blast-radius-buddy -->',
    ].join('\n'),
  );
});

test('terminal marker bodies keep the brand and one conclusion', () => {
  const failure = buildFailureBody({ headSha: 'abcdef0', reason: 'reviewer timed out' });
  const stale = buildStaleBody({ oldSha: 'abcdef0', newSha: '1234567' });
  const completion = buildCompletionBody({
    headSha: 'abcdef0',
    reviewUrl: 'https://github.com/acme/widget/pull/3#pullrequestreview-9',
  });

  assert.equal(
    failure,
    [
      '### 🧨 Blast Radius Buddy',
      '',
      'Review stopped: reviewer timed out.',
      '',
      NEW_MARKER,
    ].join('\n'),
  );
  assert.equal(
    stale,
    [
      '### 🧨 Blast Radius Buddy',
      '',
      'The PR changed while I was reviewing it. Run me again on the latest version.',
      '',
      NEW_MARKER,
    ].join('\n'),
  );
  assert.equal(
    completion,
    [
      '### 🧨 Blast Radius Buddy',
      '',
      'Review complete: [see the result](https://github.com/acme/widget/pull/3#pullrequestreview-9).',
      '',
      NEW_MARKER,
    ].join('\n'),
  );
});

test('automatic marker states bind retries and incomplete runs to the trigger', () => {
  const retry = buildRetryBody({
    headSha: 'abcdef012345',
    triggerId: 'review-requested:91',
    reason: 'Codex timed out',
    nextEligibleAt: '2026-08-24T20:15:00.000Z',
  });
  const incomplete = buildIncompleteBody({
    headSha: 'abcdef012345',
    triggerId: 'review-requested:91',
    reason: 'Claude authentication failed',
    action: 'Sign in to Claude Code, then BRB will retry automatically',
  });

  assert.equal(retry, [
    '### 🧨 Blast Radius Buddy',
    '',
    'Review paused: Codex timed out. Retrying after 2026-08-24 20:15 UTC.',
    '',
    '<!-- blast-radius-buddy-run:{"headSha":"abcdef012345","triggerId":"review-requested:91","state":"retry"} -->',
    '<!-- blast-radius-buddy -->',
  ].join('\n'));
  assert.equal(incomplete, [
    '### 🧨 Blast Radius Buddy',
    '',
    'Review stopped: Claude authentication failed. Sign in to Claude Code, then BRB will retry automatically.',
    '',
    '<!-- blast-radius-buddy-run:{"headSha":"abcdef012345","triggerId":"review-requested:91","state":"incomplete"} -->',
    '<!-- blast-radius-buddy -->',
  ].join('\n'));
});

test('automatic progress and final bodies carry hidden trigger metadata in one marker', () => {
  const progress = buildProgressBody({
    headSha: 'abcdef012345',
    triggerId: 'review-requested:91',
  });
  const final = buildFinalBody({
    headSha: 'abcdef012345',
    triggerId: 'review-requested:91',
    summary: 'Nothing needs redoing. Good to go.',
    reviewUrl: 'https://github.com/acme/widget/pull/3#pullrequestreview-9',
  });

  assert.match(progress, /"triggerId":"review-requested:91","state":"working"/);
  assert.equal(final.match(/### 🧨 Blast Radius Buddy/g)?.length, 1);
  assert.equal(final.match(/<!-- blast-radius-buddy -->/g)?.length, 1);
  assert.match(final, /Nothing needs redoing\. Good to go\./);
  assert.match(final, /\[Native review\]\(https:\/\/github\.com\/acme\/widget\/pull\/3#pullrequestreview-9\)/);
  assert.match(final, /"triggerId":"review-requested:91","state":"complete"/);
});

test('main parses render options and writes the progress body', async () => {
  const writes = [];
  const output = './tmp/progress body.md';

  await main(
    [
      'render',
      '--state', 'progress',
      '--head-sha', 'abcdef012345',
      '--completed', 'review,validation',
      '--output', output,
    ],
    { writeFile: async (...args) => writes.push(args) },
  );

  assert.deepEqual(writes, [[
    resolve(output),
    buildProgressBody({ headSha: 'abcdef012345', completedStages: ['review', 'validation'] }),
    'utf8',
  ]]);
});

test('main rejects invalid render options before writing', async () => {
  const writes = [];
  const dependencies = { writeFile: async (...args) => writes.push(args) };
  const invalidArgs = [
    ['render', '--state', 'unknown', '--output', './unknown.md'],
    ['render', '--state', 'progress', '--head-sha', 'abcdef0', '--completed', 'review,unknown', '--output', './unknown-stage.md'],
    ['render', '--state', 'failure', '--head-sha', 'abcdef0', '--output', './missing-reason.md'],
  ];

  for (const args of invalidArgs) {
    await assert.rejects(main(args, dependencies));
  }
  assert.equal(writes.length, 0);
});

test('upsertReviewComment updates the authenticated user legacy marker comment', async () => {
  const ownComment = { id: 42, body: `Old report\n\n${LEGACY_MARKER}`, user: { login: 'reviewer' } };
  const { calls, execute } = fakeExecute([
    { login: 'reviewer' },
    [[
      { id: 7, body: `Someone else's report\n\n${NEW_MARKER}`, user: { login: 'other' } },
      ownComment,
    ]],
    { id: 42 },
  ]);

  const result = await upsertReviewComment({
    repo: 'acme/widget',
    pr: 19,
    bodyFile: './review.md',
    execute,
  });

  assert.deepEqual(result, { action: 'updated', commentId: 42 });
  assert.deepEqual(calls, [
    { command: 'gh', args: ['api', 'user'] },
    {
      command: 'gh',
      args: ['api', 'repos/acme/widget/issues/19/comments', '--paginate', '--slurp'],
    },
    {
      command: 'gh',
      args: [
        'api',
        '--method',
        'PATCH',
        'repos/acme/widget/issues/comments/42',
        '--field',
        'body=@./review.md',
      ],
    },
  ]);
});

test('upsertReviewComment creates one comment when the authenticated user has none', async () => {
  const { calls, execute } = fakeExecute([
    { login: 'reviewer' },
    [[
      { id: 7, body: `Someone else's report\n\n${NEW_MARKER}`, user: { login: 'other' } },
      { id: 8, body: 'Ordinary comment', user: { login: 'reviewer' } },
    ]],
    { id: 91 },
  ]);

  const result = await upsertReviewComment({
    repo: 'acme/widget',
    pr: '19',
    bodyFile: './review.md',
    execute,
  });

  assert.deepEqual(result, { action: 'created', commentId: 91 });
  assert.deepEqual(calls.at(-1), {
    command: 'gh',
    args: [
      'api',
      '--method',
      'POST',
      'repos/acme/widget/issues/19/comments',
      '--field',
      'body=@./review.md',
    ],
  });
  assert.equal(calls.filter(({ args }) => args.includes('--method')).length, 1);
});

test('upsertReviewComment passes every gh argument without shell interpolation', async () => {
  const bodyFile = './reports/body with spaces;$(touch should-not-run).md';
  const { calls, execute } = fakeExecute([
    { login: 'reviewer' },
    [[]],
    { id: 12 },
  ]);

  await upsertReviewComment({ repo: 'acme/widget', pr: 3, bodyFile, execute });

  assert.equal(calls.at(-1).command, 'gh');
  assert.deepEqual(calls.at(-1).args.slice(-2), ['--field', `body=@${bodyFile}`]);
});
