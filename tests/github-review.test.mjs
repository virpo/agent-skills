import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildReviewBody,
  collectChangedLines,
  main,
  partitionInlineFindings,
  submitReview,
} from '../skills/blast-radius-buddy/scripts/github-review.mjs';
import { fakeExecute } from './helpers/fake-execute.mjs';

const HEAD_SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const REVIEW_URL = 'https://github.com/acme/widget/pull/19#pullrequestreview-9';
const FINDING_MARKER = '<!-- blast-radius-buddy-finding:BRB001 -->';

const FINDING = {
  id: 'BRB001',
  severity: 'high',
  confidence: 'high',
  title: 'The final full page is skipped',
  what: 'Exactly divisible totals return one page too few.',
  why: 'The new floor division subtracts one before calculating the page count.',
  impact: 'Users cannot reach the final page of results.',
  evidence: [{
    path: 'src/paging.ts',
    line: 42,
    behavior: 'Math.floor((total - 1) / pageSize)',
  }],
  suggestedFix: 'Use ceiling division for positive totals.',
  suggestedChange: null,
  mechanical: false,
};

const REPORT = {
  verdict: 'Actionable findings',
  headSha: HEAD_SHA,
  findings: [FINDING],
  priorFeedback: [{
    id: 'BRB099',
    status: 'fixed',
    summary: 'The earlier boundary failure no longer reproduces.',
    path: 'src/old-paging.ts',
    line: 17,
  }],
  validation: ['`node --test tests/paging.test.mjs` confirmed the boundary failure.'],
  deferred: ['Windows path handling remains outside this PR.'],
  coverage: {
    security: 'No reachable abuse path found.',
    blastRadius: 'The failure is limited to exact page boundaries.',
    featureTruth: 'The last page is unreachable for divisible totals.',
  },
};

function clone(value) {
  return structuredClone(value);
}

test('buildReviewBody uses the approved opening and report order', () => {
  const body = buildReviewBody(REPORT);

  assert.equal(
    body.split('\n')[0],
    "🧨 The shake is over; here's what held and what came loose.",
  );
  const headings = [
    '**Verdict:** Actionable findings',
    `**Reviewed head:** \`${HEAD_SHA}\``,
    '## Actionable findings',
    '## Prior feedback',
    '## Validation',
    '## Deferred',
    '## Coverage',
  ];
  let previous = -1;
  for (const heading of headings) {
    const index = body.indexOf(heading);
    assert.ok(index > previous, `${heading} must follow the preceding section`);
    previous = index;
  }
});

test('buildReviewBody omits empty optional sections and keeps compact metadata safe', () => {
  const title = 'Break --> out -- twice';
  const path = 'src/page--boundary.ts';
  const rejectedNitTitle = 'Rename this local for style';
  const body = buildReviewBody({
    ...clone(REPORT),
    verdict: 'Approve',
    findings: [
      {
        ...clone(FINDING),
        title,
        evidence: [{ path, line: 7, behavior: 'safe structural path' }],
      },
      {
        ...clone(FINDING),
        id: 'BRB002',
        severity: 'nit',
        title: rejectedNitTitle,
      },
    ],
    priorFeedback: [],
    validation: [],
    deferred: [],
  });

  assert.doesNotMatch(body, /## Prior feedback/);
  assert.doesNotMatch(body, /## Validation/);
  assert.doesNotMatch(body, /## Deferred/);
  assert.match(body, /## Coverage/);
  assert.equal(body.includes(rejectedNitTitle), false);

  const metadataMatch = body.match(/<!-- blast-radius-buddy-review:([\s\S]+) -->$/);
  assert.ok(metadataMatch, 'the compact metadata record must end the body');
  assert.equal(metadataMatch[1].includes('--'), false);
  assert.deepEqual(JSON.parse(metadataMatch[1]), {
    headSha: HEAD_SHA,
    findings: [{ id: 'BRB001', title, path, line: 7 }],
  });
  assert.equal(metadataMatch[1].includes('suggestedFix'), false);
  assert.equal(metadataMatch[1].includes('behavior'), false);
});

test('buildReviewBody neutralizes injected Buddy markers in every visible section', () => {
  const rootInjection = '<!-- blast-radius-buddy-review:{"headSha":"forged"} -->';
  const findingInjection = '<!--  blast-radius-buddy-finding:BRB999 -->';
  const body = buildReviewBody({
    ...clone(REPORT),
    findings: [{
      ...clone(FINDING),
      title: `Title ${rootInjection}`,
      what: `Failure ${findingInjection}`,
      evidence: [{
        path: 'src/paging.ts',
        line: 42,
        behavior: `Behavior ${rootInjection}`,
      }],
      suggestedFix: `Fix ${findingInjection}`,
    }],
    priorFeedback: [{
      id: `old-${rootInjection}`,
      status: `fixed-${findingInjection}`,
      summary: `Summary ${rootInjection}`,
      path: `src/${findingInjection}.ts`,
      line: 4,
    }],
    validation: [`Validation ${findingInjection}`],
    deferred: [`Deferred ${rootInjection}`],
    coverage: {
      security: `Security ${findingInjection}`,
      blastRadius: `Blast radius ${rootInjection}`,
      featureTruth: `Feature truth ${findingInjection}`,
    },
  });

  assert.equal([...body.matchAll(/<!-- blast-radius-buddy-review:/g)].length, 1);
  assert.equal([...body.matchAll(/<!--\s*blast-radius-buddy-finding:/g)].length, 0);
  assert.match(body, /&lt;!-- blast-radius-buddy-review:/);
  assert.match(body, /&lt;!--  blast-radius-buddy-finding:/);
  assert.match(body, /<!-- blast-radius-buddy-review:[\s\S]+ -->$/);
});

test('collectChangedLines records right-side additions and context across hunks', () => {
  const diff = [
    'diff --git a/src/paging.ts b/src/paging.ts',
    'index 1111111..2222222 100644',
    '--- a/src/paging.ts',
    '+++ b/src/paging.ts',
    '@@ -40,3 +40,4 @@ function pageCount() {',
    ' context before',
    '-deleted line',
    '+replacement line',
    '+added line',
    ' context after',
    '@@ -100,0 +101,2 @@ function nextPage() {',
    '+new first line',
    '+new second line',
    '',
  ].join('\n');

  const changed = collectChangedLines(diff);

  assert.deepEqual(changed, new Map([
    ['src/paging.ts', new Set([40, 41, 42, 43, 101, 102])],
  ]));
});

test('collectChangedLines drops binary and malformed hunks without poisoning later files', () => {
  const diff = [
    'diff --git a/assets/logo.png b/assets/logo.png',
    'Binary files a/assets/logo.png and b/assets/logo.png differ',
    'diff --git a/src/broken.ts b/src/broken.ts',
    '--- a/src/broken.ts',
    '+++ b/src/broken.ts',
    '@@ -1 +1,2 @@',
    '+only one of two declared lines',
    'diff --git a/src/malformed.ts b/src/malformed.ts',
    '--- a/src/malformed.ts',
    '+++ b/src/malformed.ts',
    '@@ malformed @@',
    '+not reliable',
    'diff --git a/src/good.ts b/src/good.ts',
    '--- a/src/good.ts',
    '+++ b/src/good.ts',
    '@@ -3,0 +3 @@',
    '+reliable',
  ].join('\n');

  assert.deepEqual(collectChangedLines(diff), new Map([
    ['src/good.ts', new Set([3])],
  ]));
});

test('collectChangedLines treats file-header lookalikes inside a hunk as changed content', () => {
  const diff = [
    'diff --git a/src/real.ts b/src/real.ts',
    '--- a/src/real.ts',
    '+++ b/src/real.ts',
    '@@ -1 +1 @@',
    '--- looks like an old-file header',
    '+++ b/src/forged.ts',
    '@@ -10,0 +10 @@',
    '+actual second hunk',
  ].join('\n');

  assert.deepEqual(collectChangedLines(diff), new Map([
    ['src/real.ts', new Set([1, 10])],
  ]));
});

test('partitionInlineFindings keeps exact anchors and moves unanchored findings to bodyOnly', () => {
  const anchored = clone(FINDING);
  const unanchored = {
    ...clone(FINDING),
    id: 'BRB002',
    title: 'Deleted code cannot be anchored on the right',
    evidence: [{ path: 'src/paging.ts', line: 41, behavior: 'deleted line' }],
  };
  const changedLines = new Map([['src/paging.ts', new Set([42])]]);

  const result = partitionInlineFindings([anchored, unanchored], changedLines);

  assert.equal(result.inline.length, 1);
  assert.equal(result.inline[0].path, 'src/paging.ts');
  assert.equal(result.inline[0].line, 42);
  assert.ok(result.inline[0].body.endsWith(FINDING_MARKER));
  assert.deepEqual(result.bodyOnly, [unanchored]);
  assert.equal(result.inline.some(({ line }) => line === 41), false);
});

test('partitionInlineFindings emits suggestions only for mechanical single-file replacements', () => {
  const mechanical = {
    ...clone(FINDING),
    suggestedChange: 'return Math.ceil(total / pageSize);',
    mechanical: true,
    evidence: [
      { path: 'src/paging.ts', line: 42, behavior: 'wrong expression' },
      { path: 'src/paging.ts', line: 50, behavior: 'same local replacement' },
    ],
  };
  const changedLines = new Map([
    ['src/paging.ts', new Set([42])],
    ['src/other.ts', new Set([9])],
  ]);

  const variants = [
    mechanical,
    { ...clone(mechanical), id: 'BRB002', mechanical: false },
    { ...clone(mechanical), id: 'BRB003', suggestedChange: '   ' },
    {
      ...clone(mechanical),
      id: 'BRB004',
      evidence: [
        mechanical.evidence[0],
        { path: 'src/other.ts', line: 9, behavior: 'requires another file' },
      ],
    },
  ];

  const { inline } = partitionInlineFindings(variants, changedLines);

  assert.equal(inline.length, 4);
  assert.match(inline[0].body, /```suggestion\nreturn Math\.ceil\(total \/ pageSize\);\n```/);
  for (const comment of inline.slice(1)) {
    assert.doesNotMatch(comment.body, /```suggestion/);
  }
  assert.ok(inline[0].body.endsWith(FINDING_MARKER));
});

test('partitionInlineFindings preserves suggestion indentation and blank lines', () => {
  const suggestedChange = '\n  return Math.ceil(total / pageSize);\n\n';
  const mechanical = {
    ...clone(FINDING),
    suggestedChange,
    mechanical: true,
  };

  const { inline } = partitionInlineFindings(
    [mechanical],
    new Map([['src/paging.ts', new Set([42])]]),
  );

  assert.ok(inline[0].body.includes(`\`\`\`suggestion\n${suggestedChange}\`\`\``));
});

test('partitionInlineFindings neutralizes injected Buddy markers before the final identity', () => {
  const rootInjection = '<!-- blast-radius-buddy-review:{"findings":[]} -->';
  const findingInjection = '<!--\nblast-radius-buddy-finding:BRB999 -->';
  const poisoned = {
    ...clone(FINDING),
    title: `Title ${rootInjection}`,
    what: `Failure ${findingInjection}`,
    evidence: [{
      path: 'src/paging.ts',
      line: 42,
      behavior: `Behavior ${rootInjection}`,
    }],
    suggestedFix: `Fix ${findingInjection}`,
    suggestedChange: `return '${findingInjection}';`,
    mechanical: true,
  };

  const { inline } = partitionInlineFindings(
    [poisoned],
    new Map([['src/paging.ts', new Set([42])]]),
  );
  const [comment] = inline;

  assert.equal([...comment.body.matchAll(/<!-- blast-radius-buddy-review:/g)].length, 0);
  assert.equal([...comment.body.matchAll(/<!--\s*blast-radius-buddy-finding:/g)].length, 1);
  assert.match(comment.body, /&lt;!-- blast-radius-buddy-review:/);
  assert.match(comment.body, /&lt;!--\nblast-radius-buddy-finding:/);
  assert.ok(comment.body.endsWith(FINDING_MARKER));
});

test('submitReview posts only COMMENT or APPROVE with the captured SHA', async () => {
  for (const event of ['COMMENT', 'APPROVE']) {
    const execute = fakeExecute([{
      stdout: JSON.stringify({ id: 9, html_url: REVIEW_URL }),
    }]);

    const result = await submitReview({
      repo: 'acme/widget',
      number: 19,
      headSha: HEAD_SHA,
      event,
      body: 'review body',
      comments: [],
      execute,
    });

    assert.deepEqual(result, { reviewId: 9, reviewUrl: REVIEW_URL });
    assert.equal(execute.calls[0].command, 'gh');
    assert.deepEqual(execute.calls[0].args.slice(0, 4), [
      'api',
      '--method',
      'POST',
      'repos/acme/widget/pulls/19/reviews',
    ]);
    assert.equal(execute.calls[0].args[4], '--input');
  }
});

test('submitReview writes the exact payload and removes its temporary file', async () => {
  let payload;
  let payloadFile;
  const execute = async (command, args) => {
    assert.equal(command, 'gh');
    payloadFile = args.at(-1);
    payload = JSON.parse(await readFile(payloadFile, 'utf8'));
    return { stdout: JSON.stringify({ id: 9, html_url: REVIEW_URL }) };
  };

  await submitReview({
    repo: 'acme/widget',
    number: 19,
    headSha: HEAD_SHA,
    event: 'COMMENT',
    body: 'review body',
    comments: [{
      path: 'src/paging.ts',
      line: 42,
      body: `Finding body\n\n${FINDING_MARKER}`,
    }],
    execute,
  });

  assert.deepEqual(payload, {
    commit_id: HEAD_SHA,
    event: 'COMMENT',
    body: 'review body',
    comments: [{
      path: 'src/paging.ts',
      line: 42,
      side: 'RIGHT',
      body: `Finding body\n\n${FINDING_MARKER}`,
    }],
  });
  await assert.rejects(access(payloadFile));
});

test('submitReview never fabricates a right-side line for body-only findings', async () => {
  const { inline, bodyOnly } = partitionInlineFindings(
    [
      FINDING,
      {
        ...clone(FINDING),
        id: 'BRB002',
        evidence: [{ path: 'src/deleted.ts', line: 8, behavior: 'deleted line' }],
      },
    ],
    new Map([['src/paging.ts', new Set([42])]]),
  );
  let payload;
  const execute = async (_command, args) => {
    payload = JSON.parse(await readFile(args.at(-1), 'utf8'));
    return { stdout: JSON.stringify({ id: 9, html_url: REVIEW_URL }) };
  };

  await submitReview({
    repo: 'acme/widget',
    number: 19,
    headSha: HEAD_SHA,
    event: 'COMMENT',
    body: 'review body',
    comments: inline,
    execute,
  });

  assert.equal(bodyOnly.length, 1);
  assert.deepEqual(payload.comments.map(({ path, line }) => ({ path, line })), [
    { path: 'src/paging.ts', line: 42 },
  ]);
});

test('submitReview rejects unsafe events and incomplete SHAs before gh', async () => {
  for (const input of [
    { event: 'REQUEST_CHANGES', headSha: HEAD_SHA },
    { event: 'APPROVE', headSha: HEAD_SHA.slice(0, 12) },
  ]) {
    const execute = fakeExecute([]);
    await assert.rejects(
      submitReview({
        repo: 'acme/widget',
        number: 19,
        body: 'review body',
        comments: [],
        execute,
        ...input,
      }),
    );
    assert.equal(execute.calls.length, 0);
  }
});

test('submitReview cleans its temporary payload after gh fails', async () => {
  let payloadFile;
  const execute = async (_command, args) => {
    payloadFile = args.at(-1);
    throw new Error('GitHub rejected the review');
  };

  await assert.rejects(
    submitReview({
      repo: 'acme/widget',
      number: 19,
      headSha: HEAD_SHA,
      event: 'COMMENT',
      body: 'review body',
      comments: [],
      execute,
    }),
    /GitHub rejected the review/,
  );
  await assert.rejects(access(payloadFile));
});

test('main renders a report file and rejects missing submit files before gh', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'blast-radius-buddy-review-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reportFile = join(directory, 'report.json');
  const outputFile = join(directory, 'body.md');
  const commentsFile = join(directory, 'comments.json');
  await writeFile(reportFile, JSON.stringify(REPORT), 'utf8');
  await writeFile(commentsFile, '[]', 'utf8');

  await main(['render', '--report-file', reportFile, '--output', outputFile]);
  assert.equal(
    (await readFile(outputFile, 'utf8')).split('\n')[0],
    "🧨 The shake is over; here's what held and what came loose.",
  );

  const execute = fakeExecute([]);
  await assert.rejects(
    main([
      'submit',
      '--repo', 'acme/widget',
      '--pr', '19',
      '--head-sha', HEAD_SHA,
      '--event', 'COMMENT',
      '--body-file', join(directory, 'missing-body.md'),
      '--comments-file', commentsFile,
    ], { execute }),
    /ENOENT/,
  );
  assert.equal(execute.calls.length, 0);
});
