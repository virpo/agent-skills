import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStartBody,
  findMarkerComment,
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

test('buildStartBody returns the exact approved start copy and marker', () => {
  assert.equal(
    buildStartBody(),
    `I am going to review this. I will update this comment with findings.\n\n${NEW_MARKER}`,
  );
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
