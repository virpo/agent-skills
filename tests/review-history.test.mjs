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
}) {
  return {
    id,
    body,
    url,
    path,
    line,
    originalLine,
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

test('loadReviewThreads preserves GraphQL path bytes', async () => {
  const exactPath = 'src/My  File.ts';
  const execute = fakeExecute([makeThreadPage({
    nodes: [{
      id: 'T-path',
      isResolved: false,
      isOutdated: false,
      resolvedBy: null,
      comments: { nodes: [comment({
        id: 'C-path',
        body: 'Keep the exact repository path',
        url: 'https://example/thread-path',
        path: exactPath,
      })] },
    }],
  })]);

  const [entry] = await loadReviewThreads({
    repo: 'acme/widget',
    number: 19,
    headSha: 'abcdef0',
    prAuthor: 'author',
    execute,
  });

  assert.equal(entry.path, exactPath);
});

test('loadReviewLedger combines threads, paginated reviews, Buddy metadata, and marker history', async () => {
  const longDismissedBody = `Dismissed root summary ${'x'.repeat(240)} PRIVATE-TAIL`;
  const metadata = {
    headSha: '0123456789abcdef',
    findings: [
      {
        id: 'BRB101',
        title: 'The cache leaks tenant state',
        path: 'src/cache.ts',
        line: 9,
      },
      {
        id: 'BRB102',
        title: 'The public fallback is intentional',
        path: 'src/api.ts',
        line: 12,
        status: 'suppressed',
      },
      {
        id: 'BRB103',
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
          body: 'The cache leaks tenant state\n\n<!-- blast-radius-buddy-finding:BRB101 -->',
          url: 'https://example/thread-open',
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
  const coalesced = entries.find(({ id }) => id === 'BRB101');
  assert.deepEqual(coalesced.statuses, ['open', 'reported']);
  assert.deepEqual(coalesced.urls, [
    'https://example/thread-open',
    'https://example/review-buddy',
  ]);
  assert.equal(coalesced.source, 'review-thread');
  assert.equal(entries.find(({ id }) => id === 'BRB102').status, 'suppressed');
  assert.equal(entries.find(({ id }) => id === 'BRB103').status, 'reported');
  assert.deepEqual(
    entries.filter(({ source }) => source === 'run-history').map(({ url }) => url),
    ['https://example/marker-current', 'https://example/marker-legacy'],
  );
  assert.doesNotMatch(compactReviewLedger(entries), /PRIVATE-TAIL/);
  assert.doesNotMatch(JSON.stringify(entries), /Full previous report/);
});

test('dismissed review state wins over embedded Buddy metadata', async () => {
  const metadata = {
    findings: [{
      id: 'BRB104',
      title: 'No longer active',
      path: 'src/old.ts',
      line: 4,
      status: 'suppressed',
    }],
  };
  const execute = fakeExecute([
    makeThreadPage({ nodes: [] }),
    makeReviewPage({
      nodes: [{
        id: 'R-dismissed-metadata',
        body: `Old report\n<!-- blast-radius-buddy-review:${JSON.stringify(metadata)} -->`,
        url: 'https://example/review-dismissed-metadata',
        state: 'DISMISSED',
        submittedAt: '2026-07-20T10:00:00Z',
        author: { login: 'reviewer' },
      }],
    }),
    { stdout: '[[]]' },
  ]);

  const entries = await loadReviewLedger({
    repo: 'acme/widget',
    number: 19,
    headSha: 'abcdef0',
    prAuthor: 'author',
    execute,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'BRB104');
  assert.equal(entries[0].status, 'dismissed');
  assert.deepEqual(entries[0].statuses, ['dismissed']);
});

test('invalid long inline identities fall back to distinct complete thread IDs', async () => {
  const markerPrefix = `BRB${'9'.repeat(180)}`;
  const firstThreadId = `THREAD-${'x'.repeat(180)}-A`;
  const secondThreadId = `THREAD-${'x'.repeat(180)}-B`;
  const execute = fakeExecute([
    makeThreadPage({
      nodes: [
        {
          id: firstThreadId,
          isResolved: false,
          isOutdated: false,
          resolvedBy: null,
          comments: { nodes: [comment({
            id: 'C-first',
            body: `First\n<!-- blast-radius-buddy-finding:${markerPrefix}A -->`,
            url: 'https://example/thread-first',
          })] },
        },
        {
          id: secondThreadId,
          isResolved: false,
          isOutdated: false,
          resolvedBy: null,
          comments: { nodes: [comment({
            id: 'C-second',
            body: `Second\n<!-- blast-radius-buddy-finding:${markerPrefix}B -->`,
            url: 'https://example/thread-second',
          })] },
        },
      ],
    }),
    makeReviewPage({ nodes: [] }),
    { stdout: '[[]]' },
  ]);

  const entries = await loadReviewLedger({
    repo: 'acme/widget',
    number: 19,
    headSha: 'abcdef0',
    prAuthor: 'author',
    execute,
  });

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(({ id }) => id), [firstThreadId, secondThreadId]);
  assert.deepEqual(entries.map(({ canonicalKey }) => canonicalKey), [
    firstThreadId,
    secondThreadId,
  ]);
});

test('ledger preserves structural paths and URLs while compact output stays bounded', async () => {
  const longPath = `src/${'deep-segment/'.repeat(20)}file.ts`;
  const normalizedTitle = `Forged summary ${'s'.repeat(180)} SUMMARY-TAIL`;
  const longUrl = `https://example.com/reviews/${'u'.repeat(520)}?keep=exact`;
  const invalidId = `BRB${'8'.repeat(180)}INVALID-ID-TAIL`;
  const metadata = {
    findings: [
      {
        id: '\r\nBRB201\u0000',
        title: `Forged\nsummary\u0007\u0085${'s'.repeat(180)} SUMMARY-TAIL`,
        path: longPath,
        line: 7,
      },
      {
        id: invalidId,
        title: 'Must be rejected',
        path: 'src/rejected.ts',
        line: 8,
      },
    ],
  };
  const execute = fakeExecute([
    makeThreadPage({ nodes: [] }),
    makeReviewPage({
      nodes: [
        {
          id: 'R-structural',
          body: `Old report\n<!-- blast-radius-buddy-review:${JSON.stringify(metadata)} -->`,
          url: longUrl,
          state: 'COMMENTED',
          submittedAt: '2026-07-20T10:00:00Z',
          author: { login: 'reviewer' },
        },
        {
          id: 'R-invalid-url',
          body: `<!-- blast-radius-buddy-review:${JSON.stringify({
            findings: [{ id: 'BRB202', title: 'Invalid URL', path: 'src/url.ts', line: 2 }],
          })} -->`,
          url: 'javascript:alert(1)',
          state: 'COMMENTED',
          submittedAt: '2026-07-20T11:00:00Z',
          author: { login: 'reviewer' },
        },
      ],
    }),
    { stdout: '[[]]' },
  ]);

  const entries = await loadReviewLedger({
    repo: 'acme/widget',
    number: 19,
    headSha: 'abcdef0',
    prAuthor: 'author',
    execute,
  });
  const preserved = entries.find(({ id }) => id === 'BRB201');
  const packet = compactReviewLedger([preserved]);

  assert.deepEqual(entries.map(({ id }) => id), ['BRB201', 'BRB202']);
  assert.equal(preserved.summary, normalizedTitle);
  assert.equal(preserved.path, longPath);
  assert.equal(preserved.url, longUrl);
  assert.equal(entries.find(({ id }) => id === 'BRB202').url, null);
  assert.equal(packet.split('\n').length, 1);
  assert.doesNotMatch(packet, /[\u0000-\u001f\u007f-\u009f]/);
  assert.ok(packet.length <= 480, `packet line is ${packet.length} characters`);
  assert.doesNotMatch(packet, /SUMMARY-TAIL/);
  assert.equal(packet.includes(longUrl), false);
  assert.equal(packet.includes('https://example.com/reviews/'), false);
});

test('metadata paths preserve ordinary spaces and reject C0 and C1 controls', async () => {
  const exactPath = ' src/Metadata  File.ts ';
  const metadata = {
    findings: [
      { id: 'BRB401', title: 'Exact path', path: exactPath, line: 3 },
      { id: 'BRB402', title: 'Bad path', path: 'src/Bad\nPath.ts', line: 4 },
      { id: 'BRB403', title: 'C1 path', path: 'src/Bad\u0085Path.ts', line: 5 },
    ],
  };
  const execute = fakeExecute([
    makeThreadPage({ nodes: [] }),
    makeReviewPage({
      nodes: [{
        id: 'R-paths',
        body: `<!-- blast-radius-buddy-review:${JSON.stringify(metadata)} -->`,
        url: 'https://example/review-paths',
        state: 'COMMENTED',
        submittedAt: '2026-07-20T10:00:00Z',
        author: { login: 'reviewer' },
      }],
    }),
    { stdout: '[[]]' },
  ]);

  const entries = await loadReviewLedger({
    repo: 'acme/widget',
    number: 19,
    headSha: 'abcdef0',
    prAuthor: 'author',
    execute,
  });
  const preserved = entries.find(({ id }) => id === 'BRB401');
  const rejected = entries.find(({ id }) => id === 'BRB402');
  const rejectedC1 = entries.find(({ id }) => id === 'BRB403');

  assert.equal(preserved.path, exactPath);
  assert.equal(rejected.path, null);
  assert.equal(rejectedC1.path, null);
  assert.match(compactReviewLedger([preserved]), /src\/Metadata File\.ts/);
  assert.equal(preserved.path, exactPath);
});

test('inline finding marker coalesces a live thread with root review metadata', async () => {
  const metadata = {
    findings: [{
      id: 'BRB001',
      title: 'The cache leaks tenant state',
      path: 'src/cache.ts',
      line: 9,
    }],
  };
  const execute = fakeExecute([
    makeThreadPage({
      nodes: [{
        id: 'T-live',
        isResolved: false,
        isOutdated: false,
        resolvedBy: null,
        comments: { nodes: [comment({
          id: 'C-live',
          body: 'The cache leaks tenant state\n\n<!-- blast-radius-buddy-finding:BRB001 -->',
          url: 'https://example/thread-live',
        })] },
      }],
    }),
    makeReviewPage({
      nodes: [{
        id: 'R-buddy-BRB001',
        body: `Old report\n<!-- blast-radius-buddy-review:${JSON.stringify(metadata)} -->`,
        url: 'https://example/review-BRB001',
        state: 'COMMENTED',
        submittedAt: '2026-07-20T10:00:00Z',
        author: { login: 'buddy' },
      }],
    }),
    { stdout: '[[]]' },
  ]);

  const entries = await loadReviewLedger({
    repo: 'acme/widget',
    number: 19,
    headSha: 'abcdef0',
    prAuthor: 'author',
    execute,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'BRB001');
  assert.equal(entries[0].canonicalKey, 'BRB001');
  assert.equal(entries[0].summary, 'The cache leaks tenant state');
  assert.deepEqual(entries[0].statuses, ['open', 'reported']);
  assert.deepEqual(entries[0].urls, [
    'https://example/thread-live',
    'https://example/review-BRB001',
  ]);
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
