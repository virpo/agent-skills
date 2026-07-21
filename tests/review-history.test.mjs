import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyReviewAssessments,
  classifyThread,
  compactReviewLedger,
  loadReviewLedger,
  loadReviewThreads,
  main,
} from '../skills/blast-radius-buddy/scripts/review-history.mjs';
import { fakeExecute } from './helpers/fake-execute.mjs';

function makeThreadPage({ nodes, hasNextPage = false, endCursor = null }) {
  return {
    stdout: JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes,
              pageInfo: { hasNextPage, endCursor },
            },
          },
        },
      },
    }),
  };
}

function makeReviewPage({ nodes, hasNextPage = false, endCursor = null }) {
  return {
    stdout: JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviews: {
              nodes,
              pageInfo: { hasNextPage, endCursor },
            },
          },
        },
      },
    }),
  };
}

function comment({
  id,
  body,
  url,
  path = 'src/cache.ts',
  line = 9,
  originalLine = null,
  canonicalKey,
}) {
  return {
    id,
    body,
    url,
    path,
    line,
    originalLine,
    canonicalKey,
    author: { login: 'reviewer' },
    pullRequestReview: { state: 'CHANGES_REQUESTED' },
  };
}

test('classifyThread distinguishes every observable thread state', () => {
  assert.equal(classifyThread({ isResolved: false, isOutdated: false }, 'author'), 'open');
  assert.equal(
    classifyThread({ isResolved: true, isOutdated: false, resolvedBy: { login: 'author' } }, 'author'),
    'author-resolved',
  );
  assert.equal(
    classifyThread({ isResolved: true, isOutdated: false, resolvedBy: { login: 'reviewer' } }, 'author'),
    'resolved',
  );
  assert.equal(
    classifyThread({ isResolved: true, isOutdated: true, resolvedBy: { login: 'author' } }, 'author'),
    'outdated',
  );
});

test('loadReviewThreads follows review-thread pagination and normalizes roots', async () => {
  const pageOne = makeThreadPage({
    nodes: [{
      id: 'T1',
      isResolved: false,
      isOutdated: false,
      resolvedBy: null,
      comments: {
        nodes: [comment({
          id: 'C1',
          body: 'The cache leaks tenant state',
          url: 'https://example/T1',
        })],
      },
    }],
    hasNextPage: true,
    endCursor: 'cursor-1',
  });
  const pageTwo = makeThreadPage({
    nodes: [{
      id: 'T2',
      isResolved: false,
      isOutdated: true,
      resolvedBy: null,
      comments: {
        nodes: [comment({
          id: 'C2',
          body: 'Old line',
          url: 'https://example/T2',
          line: null,
          originalLine: 4,
        })],
      },
    }],
  });
  const execute = fakeExecute([pageOne, pageTwo]);

  const entries = await loadReviewThreads({
    repo: 'acme/widget',
    number: 19,
    headSha: 'abcdef0',
    prAuthor: 'author',
    execute,
  });

  assert.equal(execute.calls.length, 2);
  assert.deepEqual(entries.map(({ id, status, line, summary, source }) => ({
    id, status, line, summary, source,
  })), [
    {
      id: 'T1',
      status: 'open',
      line: 9,
      summary: 'The cache leaks tenant state',
      source: 'review-thread',
    },
    {
      id: 'T2',
      status: 'outdated',
      line: 4,
      summary: 'Old line',
      source: 'review-thread',
    },
  ]);
  const firstQuery = execute.calls[0].args.join(' ');
  assert.match(firstQuery, /reviewThreads\(first: 100, after: \$cursor\)/);
  for (const field of [
    'id', 'isResolved', 'isOutdated', 'resolvedBy', 'body', 'url', 'path',
    'line', 'originalLine', 'author', 'pullRequestReview', 'state',
  ]) assert.match(firstQuery, new RegExp(`\\b${field}\\b`));
  assert.doesNotMatch(firstQuery, /cursor=cursor-1/);
  assert.match(execute.calls[1].args.join(' '), /cursor=cursor-1/);
});

test('loadReviewLedger combines threads, paginated reviews, Buddy metadata, and marker history', async () => {
  const longDismissedBody = `Dismissed root summary ${'x'.repeat(240)} PRIVATE-TAIL`;
  const metadata = {
    headSha: '0123456789abcdef',
    findings: [
      {
        id: 'F-cache',
        canonicalKey: 'tenant-cache',
        title: 'The cache leaks tenant state',
        path: 'src/cache.ts',
        line: 9,
      },
      {
        id: 'F-intentional',
        title: 'The public fallback is intentional',
        path: 'src/api.ts',
        line: 12,
        status: 'suppressed',
      },
      {
        id: 'F-untrusted',
        title: 'A prior report cannot invent another state',
        path: 'src/api.ts',
        line: 15,
        status: 'fixed',
      },
    ],
  };
  const threadPage = makeThreadPage({
    nodes: [
      {
        id: 'T-open', isResolved: false, isOutdated: false, resolvedBy: null,
        comments: { nodes: [comment({
          id: 'C-open',
          body: 'The cache leaks tenant state',
          url: 'https://example/thread-open',
          canonicalKey: 'tenant-cache',
        })] },
      },
      {
        id: 'T-resolved', isResolved: true, isOutdated: false,
        resolvedBy: { login: 'reviewer' },
        comments: { nodes: [comment({
          id: 'C-resolved', body: 'Bound the queue', url: 'https://example/thread-resolved',
        })] },
      },
      {
        id: 'T-author', isResolved: true, isOutdated: false,
        resolvedBy: { login: 'author' },
        comments: { nodes: [comment({
          id: 'C-author', body: 'Check the fallback', url: 'https://example/thread-author',
        })] },
      },
      {
        id: 'T-outdated', isResolved: false, isOutdated: true, resolvedBy: null,
        comments: { nodes: [comment({
          id: 'C-outdated', body: 'Old line', url: 'https://example/thread-outdated',
        })] },
      },
    ],
  });
  const reviewPageOne = makeReviewPage({
    nodes: [{
      id: 'R-dismissed',
      body: longDismissedBody,
      url: 'https://example/review-dismissed',
      state: 'DISMISSED',
      submittedAt: '2026-07-20T10:00:00Z',
      author: { login: 'reviewer' },
    }],
    hasNextPage: true,
    endCursor: 'reviews-1',
  });
  const reviewPageTwo = makeReviewPage({
    nodes: [{
      id: 'R-buddy',
      body: `Full previous report that must not enter the packet.\n\n<!-- blast-radius-buddy-review:${JSON.stringify(metadata)} -->`,
      url: 'https://example/review-buddy',
      state: 'COMMENTED',
      submittedAt: '2026-07-21T10:00:00Z',
      author: { login: 'buddy' },
    }],
  });
  const issueComments = {
    stdout: JSON.stringify([[
      {
        id: 91,
        body: 'Review complete for `abcdef0`: https://example/review-buddy\n\n<!-- blast-radius-buddy -->',
        html_url: 'https://example/marker-current',
      },
      {
        id: 81,
        body: 'Old run\n\n<!-- review-tube-man -->',
        html_url: 'https://example/marker-legacy',
      },
      { id: 71, body: 'Unrelated comment', html_url: 'https://example/unrelated' },
    ]]),
  };
  const execute = fakeExecute([
    threadPage,
    reviewPageOne,
    reviewPageTwo,
    issueComments,
  ]);

  const entries = await loadReviewLedger({
    repo: 'acme/widget',
    number: 19,
    headSha: 'abcdef0',
    prAuthor: 'author',
    execute,
  });

  assert.equal(execute.calls.length, 4);
  const firstReviewQuery = execute.calls[1].args.join(' ');
  assert.match(firstReviewQuery, /reviews\(first: 100, after: \$cursor\)/);
  for (const field of ['id', 'body', 'url', 'state', 'submittedAt', 'author']) {
    assert.match(firstReviewQuery, new RegExp(`\\b${field}\\b`));
  }
  assert.match(execute.calls[2].args.join(' '), /cursor=reviews-1/);
  assert.deepEqual(execute.calls[3], {
    command: 'gh',
    args: ['api', 'repos/acme/widget/issues/19/comments', '--paginate', '--slurp'],
    options: {},
  });

  assert.deepEqual(
    entries.map(({ status }) => status),
    ['open', 'resolved', 'author-resolved', 'outdated', 'dismissed', 'suppressed', 'reported', 'reported', 'reported'],
  );
  const coalesced = entries.find(({ id }) => id === 'tenant-cache');
  assert.deepEqual(coalesced.statuses, ['open', 'reported']);
  assert.deepEqual(coalesced.urls, [
    'https://example/thread-open',
    'https://example/review-buddy',
  ]);
  assert.equal(coalesced.source, 'review-thread');
  assert.equal(entries.find(({ id }) => id === 'F-intentional').status, 'suppressed');
  assert.equal(entries.find(({ id }) => id === 'F-untrusted').status, 'reported');
  assert.deepEqual(
    entries.filter(({ source }) => source === 'run-history').map(({ url }) => url),
    ['https://example/marker-current', 'https://example/marker-legacy'],
  );
  assert.doesNotMatch(JSON.stringify(entries), /PRIVATE-TAIL/);
  assert.doesNotMatch(JSON.stringify(entries), /Full previous report/);
});

test('applyReviewAssessments uses only explicit host revalidation transitions', () => {
  const entries = [
    { id: 'T1', status: 'open' },
    { id: 'T2', status: 'open' },
    { id: 'T3', status: 'resolved' },
    { id: 'T4', status: 'resolved' },
    { id: 'T5', status: 'author-resolved' },
    { id: 'T6', status: 'dismissed' },
    { id: 'T7', status: 'suppressed' },
    { id: 'T8', status: 'outdated' },
    { id: 'T9', status: 'open' },
  ];
  const assessed = applyReviewAssessments(entries, [
    { id: 'T1', present: false },
    { id: 'T2', present: true },
    { id: 'T3', present: true },
    { id: 'T4', present: false },
    { id: 'T5', present: true },
    { id: 'T6', present: true },
    { id: 'T7', present: false },
    { id: 'T8', present: true },
  ]);

  assert.deepEqual(assessed.map(({ status }) => status), [
    'fixed',
    'still-open',
    'resolved-but-still-present',
    'fixed',
    'author-resolved',
    'dismissed',
    'suppressed',
    'outdated',
    'open',
  ]);
  assert.deepEqual(entries.map(({ status }) => status), [
    'open', 'open', 'resolved', 'resolved', 'author-resolved',
    'dismissed', 'suppressed', 'outdated', 'open',
  ]);
});

test('compactReviewLedger coalesces canonical roots into bounded single lines', () => {
  const entries = [
    {
      id: 'summary-F1',
      canonicalKey: 'F1',
      status: 'reported',
      path: 'src/cache.ts',
      line: 9,
      summary: `The cache leaks tenant state ${'old detail '.repeat(80)}OLD-BODY-TAIL`,
      url: 'https://example/review',
      source: 'root-review',
    },
    {
      id: 'thread-F1',
      canonicalKey: 'F1',
      status: 'open',
      path: 'src/cache.ts',
      line: 9,
      summary: 'The cache leaks tenant state',
      url: 'https://example/thread',
      source: 'review-thread',
    },
  ];

  const packet = compactReviewLedger(entries);

  assert.equal(packet.split('\n').length, 1);
  assert.match(packet, /\[reported\/open\]/);
  assert.match(packet, /https:\/\/example\/review/);
  assert.match(packet, /https:\/\/example\/thread/);
  assert.doesNotMatch(packet, /OLD-BODY-TAIL/);
  assert.ok(packet.length <= 500, `packet line is ${packet.length} characters`);
});

test('read CLI prints normalized JSON and invokes only read-only GitHub operations', async () => {
  const execute = fakeExecute([
    makeThreadPage({ nodes: [] }),
    makeReviewPage({ nodes: [] }),
    { stdout: '[[]]' },
  ]);
  const output = [];

  await main([
    'read',
    '--repo', 'acme/widget',
    '--pr', '19',
    '--head-sha', 'abcdef0',
    '--author', 'author',
  ], {
    execute,
    writeStdout: (value) => output.push(value),
  });

  assert.deepEqual(output, ['[]\n']);
  assert.deepEqual(execute.calls.map(({ command }) => command), ['gh', 'gh', 'gh']);
  for (const { args } of execute.calls) {
    assert.equal(args.includes('--method'), false);
    assert.equal(args.includes('POST'), false);
    assert.equal(args.includes('PATCH'), false);
    assert.equal(args.includes('DELETE'), false);
  }
});

test('read CLI validates every input before invoking GitHub', async () => {
  const cases = [
    {
      args: ['--repo', 'acme', '--pr', '19', '--head-sha', 'abcdef0', '--author', 'author'],
      error: /repo must use OWNER\/REPO format/,
    },
    {
      args: ['--repo', 'acme/widget', '--pr', '0', '--head-sha', 'abcdef0', '--author', 'author'],
      error: /pr must be a positive safe integer/,
    },
    {
      args: ['--repo', 'acme/widget', '--pr', '19', '--head-sha', 'bad', '--author', 'author'],
      error: /head-sha must be a 7-64 character hexadecimal commit id/,
    },
    {
      args: ['--repo', 'acme/widget', '--pr', '19', '--head-sha', 'abcdef0', '--author', ''],
      error: /--author is required/,
    },
  ];

  for (const { args, error } of cases) {
    const execute = fakeExecute([]);
    await assert.rejects(main(['read', ...args], { execute }), error);
    assert.equal(execute.calls.length, 0);
  }
});
