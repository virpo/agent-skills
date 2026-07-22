import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  buildReviewBody,
  collectChangedLines,
  findingReviewLinkage,
  main,
  partitionInlineFindings,
  prepareReview,
  submitReview,
} from '../skills/blast-radius-buddy/scripts/github-review.mjs';
import { fakeExecute } from './helpers/fake-execute.mjs';

const HEAD_SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const REVIEW_URL = 'https://github.com/acme/widget/pull/19#pullrequestreview-9';
const REVIEW_LINKAGE_MARKER = /<!-- blast-radius-buddy-finding:BRB001:BRBK1_[0-9a-f]{64} -->$/;

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

const COMMENT_GATES = {
  reviewersComplete: true,
  reproductionComplete: true,
  materialUncertainty: true,
  verifierVerdict: 'uphold',
  findings: [{ id: 'BRB001' }],
  failedRequiredChecks: [],
  headUnchanged: true,
};

const APPROVE_REPORT = {
  ...structuredClone(REPORT),
  verdict: 'Approve',
  findings: [],
  priorFeedback: [],
  validation: [],
  deferred: [],
};

const APPROVE_GATES = {
  reviewersComplete: true,
  reproductionComplete: true,
  materialUncertainty: false,
  verifierVerdict: 'clean',
  findings: [],
  failedRequiredChecks: [],
  headUnchanged: true,
};

function clone(value) {
  return structuredClone(value);
}

function forgedArtifactHash(event, kind, contents) {
  return createHash('sha256')
    .update(`1\0${HEAD_SHA}\0${event}\0${kind}\0${contents}`)
    .digest('hex');
}

function sourceSubmission(report, diff, gates) {
  const prepared = prepareReview(clone(report), diff, clone(gates));
  return {
    repo: 'acme/widget',
    number: 19,
    report: clone(report),
    diff,
    gates: clone(gates),
    body: prepared.body,
    comments: prepared.comments,
  };
}

function matchingHeadResponse() {
  return { stdout: JSON.stringify({ headRefOid: HEAD_SHA }) };
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

test('buildReviewBody strictly rejects malformed or contradictory normalized reports', () => {
  const without = (object, field) => {
    const copy = clone(object);
    delete copy[field];
    return copy;
  };
  const invalidReports = [
    [{ ...clone(REPORT), extra: true }, /unexpected field extra/],
    [without(REPORT, 'coverage'), /report\.coverage is required/],
    [{ ...clone(REPORT), findings: [{ ...clone(FINDING), severity: 'nit' }] }, /severity/],
    [{ ...clone(REPORT), findings: [{ ...clone(FINDING), confidence: 'low' }] }, /confidence/],
    [{
      ...clone(REPORT),
      findings: [{ ...clone(FINDING), evidence: [{ path: 'src/a.ts', line: '1', behavior: 'x' }] }],
    }, /evidence\[0\]\.line/],
    [{
      ...clone(REPORT),
      findings: [{ ...clone(FINDING), evidence: [{ path: '../outside', line: 1, behavior: 'x' }] }],
    }, /evidence\[0\]\.path/],
    [{
      ...clone(REPORT),
      findings: [{ ...clone(FINDING), evidence: [{ path: 'src/a.ts', line: 0, behavior: 'x' }] }],
    }, /evidence\[0\]\.line/],
    [{ ...clone(APPROVE_REPORT), findings: [clone(FINDING)] }, /Approve.*findings/i],
    [{ ...clone(APPROVE_REPORT), deferred: ['Unresolved behavior.'] }, /Approve.*deferred/i],
    [{ ...clone(REPORT), findings: [] }, /Actionable findings.*finding/i],
    [{ ...clone(APPROVE_REPORT), verdict: 'Review completed with uncertainty' }, /uncertainty.*deferred/i],
  ];

  for (const [report, error] of invalidReports) {
    assert.throws(() => buildReviewBody(report), error);
  }
});

test('prepareReview derives the event and head from explicit host gates', () => {
  const diff = [
    '--- a/src/paging.ts',
    '+++ b/src/paging.ts',
    '@@ -42 +42 @@',
    '-old line',
    '+new line',
  ].join('\n');

  const prepared = prepareReview(clone(REPORT), diff, clone(COMMENT_GATES));

  assert.deepEqual(Object.keys(prepared).sort(), [
    'body', 'comments', 'event', 'headSha',
  ]);
  assert.equal(prepared.headSha, HEAD_SHA);
  assert.equal(prepared.event, 'COMMENT');
});

test('prepareReview refuses approval reports when any approval gate fails', () => {
  for (const gates of [
    { ...clone(APPROVE_GATES), failedRequiredChecks: ['test'] },
    { ...clone(APPROVE_GATES), materialUncertainty: true },
    { ...clone(APPROVE_GATES), headUnchanged: false },
  ]) {
    assert.throws(
      () => prepareReview(clone(APPROVE_REPORT), '', gates),
      /(?:Approve|marker only|gate|COMMENT)/i,
    );
  }
});

test('buildReviewBody omits empty optional sections and keeps compact metadata safe', () => {
  const title = 'Break --> out -- twice';
  const path = 'src/page--boundary.ts';
  const body = buildReviewBody({
    ...clone(REPORT),
    findings: [
      {
        ...clone(FINDING),
        title,
        evidence: [{ path, line: 7, behavior: 'safe structural path' }],
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

  const metadataMatch = body.match(/<!-- blast-radius-buddy-review:([\s\S]+) -->$/);
  assert.ok(metadataMatch, 'the compact metadata record must end the body');
  assert.equal(metadataMatch[1].includes('--'), false);
  const parsedMetadata = JSON.parse(metadataMatch[1]);
  assert.match(parsedMetadata.findings[0].linkage, /^BRBK1_[0-9a-f]{64}$/);
  assert.deepEqual(parsedMetadata, {
    headSha: HEAD_SHA,
    findings: [{
      id: 'BRB001',
      linkage: parsedMetadata.findings[0].linkage,
      title,
      path,
      line: 7,
    }],
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

test('collectChangedLines rejects a hunk that overruns its declared line counts', () => {
  const diff = [
    'diff --git a/src/overlong.ts b/src/overlong.ts',
    '--- a/src/overlong.ts',
    '+++ b/src/overlong.ts',
    '@@ -0,0 +1 @@',
    '+declared line',
    '+unexpected extra line',
  ].join('\n');

  assert.deepEqual(collectChangedLines(diff), new Map());
});

test('collectChangedLines accepts concatenated file patches without diff headers', () => {
  const diff = [
    '--- a/src/first.ts',
    '+++ b/src/first.ts',
    '@@ -0,0 +1 @@',
    '+first file line',
    '--- a/src/second.ts',
    '+++ b/src/second.ts',
    '@@ -0,0 +7 @@',
    '+second file line',
  ].join('\n');

  assert.deepEqual(collectChangedLines(diff), new Map([
    ['src/first.ts', new Set([1])],
    ['src/second.ts', new Set([7])],
  ]));
});

test('collectChangedLines preserves prior anchors before a concatenated deleted file', () => {
  const diff = [
    '--- a/src/kept.ts',
    '+++ b/src/kept.ts',
    '@@ -0,0 +3 @@',
    '+kept file line',
    '--- a/src/deleted.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-deleted file line',
  ].join('\n');

  assert.deepEqual(collectChangedLines(diff), new Map([
    ['src/kept.ts', new Set([3])],
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
  assert.match(result.inline[0].body, REVIEW_LINKAGE_MARKER);
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
  assert.match(inline[0].body, REVIEW_LINKAGE_MARKER);
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
  assert.match(comment.body, REVIEW_LINKAGE_MARKER);
});

test('prepareReview deterministically writes safe body metadata and inline finding markers', () => {
  const unanchored = {
    ...clone(FINDING),
    id: 'BRB002',
    title: 'Deleted behavior still needs a body finding',
    evidence: [{ path: 'src/deleted.ts', line: 8, behavior: 'deleted code path' }],
  };
  const report = {
    ...clone(REPORT),
    findings: [FINDING, unanchored],
  };
  const gates = {
    ...clone(COMMENT_GATES),
    findings: [{ id: 'BRB001' }, { id: 'BRB002' }],
  };
  const diff = [
    'diff --git a/src/paging.ts b/src/paging.ts',
    '--- a/src/paging.ts',
    '+++ b/src/paging.ts',
    '@@ -42 +42 @@',
    '-return Math.floor(total / pageSize);',
    '+return Math.floor((total - 1) / pageSize);',
  ].join('\n');

  const first = prepareReview(report, diff, gates);
  const second = prepareReview(clone(report), diff, clone(gates));

  assert.deepEqual(second, first);
  assert.match(first.body, /<!-- blast-radius-buddy-review:/);
  assert.match(first.body, /Deleted behavior still needs a body finding/);
  assert.deepEqual(first.comments.map(({ path, line }) => ({ path, line })), [
    { path: 'src/paging.ts', line: 42 },
  ]);
  assert.match(first.comments[0].body, REVIEW_LINKAGE_MARKER);
});

test('prepareReview links root metadata and inline comments with a review-linkage fingerprint', () => {
  const diff = [
    '--- a/src/paging.ts',
    '+++ b/src/paging.ts',
    '@@ -42 +42 @@',
    '-old line',
    '+new line',
  ].join('\n');

  const prepared = prepareReview(clone(REPORT), diff, clone(COMMENT_GATES));
  const metadataMatch = prepared.body.match(/<!-- blast-radius-buddy-review:([\s\S]+) -->$/);
  assert.ok(metadataMatch);
  const metadata = JSON.parse(metadataMatch[1]);
  const linkage = metadata.findings[0].linkage;

  assert.match(linkage, /^BRBK1_[0-9a-f]{64}$/);
  assert.ok(prepared.comments[0].body.endsWith(
    `<!-- blast-radius-buddy-finding:BRB001:${linkage} -->`,
  ));
});

test('finding review-linkage fingerprints ignore run-local details but preserve paths', () => {
  const linkage = findingReviewLinkage(FINDING);
  const rerun = {
    ...clone(FINDING),
    id: 'BRB999',
    title: `  ${FINDING.title.toUpperCase()}  `,
    what: FINDING.what.toUpperCase(),
    evidence: [{
      path: 'src/paging.ts',
      line: 99,
      behavior: 'Different observation from the rerun.',
    }],
  };

  assert.equal(findingReviewLinkage(rerun), linkage);
  assert.notEqual(
    findingReviewLinkage({
      ...clone(rerun),
      evidence: [{ ...rerun.evidence[0], path: 'src/Paging.ts' }],
    }),
    linkage,
  );
});

test('prepareReview rejects duplicate actionable finding IDs', () => {
  const duplicate = {
    ...clone(FINDING),
    title: 'A different finding with a colliding stable identity',
  };

  assert.throws(
    () => prepareReview({
      ...clone(REPORT),
      findings: [clone(FINDING), duplicate],
    }, '', clone(COMMENT_GATES)),
    /duplicate finding ID BRB001/,
  );
});

test('submitReview rejects a forged APPROVE artifact before any GitHub call', async () => {
  const body = 'Forged clean review';
  const comments = [];
  const preparedEvent = {
    version: 1,
    headSha: HEAD_SHA,
    event: 'APPROVE',
    bodySha256: forgedArtifactHash('APPROVE', 'body', body),
    commentsSha256: forgedArtifactHash('APPROVE', 'comments', `${JSON.stringify(comments)}\n`),
  };

  for (const forgedInput of [
    { preparedEvent },
    { event: 'APPROVE' },
    { headSha: HEAD_SHA },
    { digest: preparedEvent.bodySha256 },
  ]) {
    const execute = fakeExecute([]);
    await assert.rejects(
      submitReview({
        repo: 'acme/widget',
        number: 19,
        ...forgedInput,
        body,
        comments,
        execute,
      }),
      /report.*required|unexpected option/i,
    );
    assert.equal(execute.calls.length, 0);
  }
});

test('submitReview re-prepares source artifacts then checks the exact head immediately before POST', async () => {
  const diff = [
    '--- a/src/paging.ts',
    '+++ b/src/paging.ts',
    '@@ -42 +42 @@',
    '-old line',
    '+new line',
  ].join('\n');
  const prepared = prepareReview(clone(REPORT), diff, clone(COMMENT_GATES));
  const operations = [];
  let payload;
  const execute = async (command, args) => {
    assert.equal(command, 'gh');
    if (args[0] === 'pr') {
      operations.push('check-head');
      return { stdout: JSON.stringify({ headRefOid: HEAD_SHA }) };
    }
    operations.push('post-review');
    payload = JSON.parse(await readFile(args.at(-1), 'utf8'));
    return { stdout: JSON.stringify({ id: 9, html_url: REVIEW_URL }) };
  };

  const result = await submitReview({
    repo: 'acme/widget',
    number: 19,
    report: clone(REPORT),
    diff,
    gates: clone(COMMENT_GATES),
    body: prepared.body,
    comments: prepared.comments,
    execute,
  });

  assert.deepEqual(result, { reviewId: 9, reviewUrl: REVIEW_URL });
  assert.deepEqual(operations, ['check-head', 'post-review']);
  assert.equal(payload.event, 'COMMENT');
  assert.equal(payload.commit_id, HEAD_SHA);
});

test('submitReview rejects a stale head after one read and performs no POST', async () => {
  const staleHeadSha = '1234567890abcdef1234567890abcdef12345678';
  const prepared = prepareReview(clone(APPROVE_REPORT), '', clone(APPROVE_GATES));
  const execute = fakeExecute([{
    stdout: JSON.stringify({ headRefOid: staleHeadSha }),
  }]);

  await assert.rejects(
    submitReview({
      repo: 'acme/widget',
      number: 19,
      report: clone(APPROVE_REPORT),
      diff: '',
      gates: clone(APPROVE_GATES),
      body: prepared.body,
      comments: prepared.comments,
      execute,
    }),
    /head changed.*abcdef.*123456/i,
  );
  assert.deepEqual(execute.calls.map(({ args }) => args[0]), ['pr']);
});

test('submitReview posts only COMMENT or APPROVE with the captured SHA', async () => {
  for (const event of ['COMMENT', 'APPROVE']) {
    const submission = event === 'APPROVE'
      ? sourceSubmission(APPROVE_REPORT, '', APPROVE_GATES)
      : sourceSubmission(REPORT, '', COMMENT_GATES);
    const execute = fakeExecute([
      matchingHeadResponse(),
      { stdout: JSON.stringify({ id: 9, html_url: REVIEW_URL }) },
    ]);

    const result = await submitReview({
      ...submission,
      execute,
    });

    assert.deepEqual(result, { reviewId: 9, reviewUrl: REVIEW_URL });
    assert.equal(execute.calls[1].command, 'gh');
    assert.deepEqual(execute.calls[1].args.slice(0, 4), [
      'api',
      '--method',
      'POST',
      'repos/acme/widget/pulls/19/reviews',
    ]);
    assert.equal(execute.calls[1].args[4], '--input');
  }
});

test('submitReview rejects body or comment artifacts that differ from source preparation', async () => {
  const submission = sourceSubmission(REPORT, '', COMMENT_GATES);
  for (const mismatch of [
    { body: `${submission.body}\nchanged`, comments: submission.comments },
    { body: submission.body, comments: [{ path: 'src/paging.ts', line: 42, body: 'changed' }] },
  ]) {
    const noExecute = fakeExecute([]);
    await assert.rejects(
      submitReview({
        ...submission,
        body: mismatch.body,
        comments: mismatch.comments,
        execute: noExecute,
      }),
      /do not match source artifacts/i,
    );
    assert.equal(noExecute.calls.length, 0);
  }
});

test('submitReview writes the exact payload and removes its temporary file', async () => {
  const diff = [
    '--- a/src/paging.ts',
    '+++ b/src/paging.ts',
    '@@ -42 +42 @@',
    '-old line',
    '+new line',
  ].join('\n');
  const submission = sourceSubmission(REPORT, diff, COMMENT_GATES);
  let payload;
  let payloadFile;
  const execute = async (command, args) => {
    assert.equal(command, 'gh');
    if (args[0] === 'pr') return matchingHeadResponse();
    payloadFile = args.at(-1);
    payload = JSON.parse(await readFile(payloadFile, 'utf8'));
    return { stdout: JSON.stringify({ id: 9, html_url: REVIEW_URL }) };
  };

  await submitReview({
    ...submission,
    execute,
  });

  assert.deepEqual(payload, {
    commit_id: HEAD_SHA,
    event: 'COMMENT',
    body: submission.body,
    comments: submission.comments.map((comment) => ({ ...comment, side: 'RIGHT' })),
  });
  await assert.rejects(access(payloadFile));
});

test('submitReview never fabricates a right-side line for body-only findings', async () => {
  const bodyOnlyFinding = {
    ...clone(FINDING),
    id: 'BRB002',
    evidence: [{ path: 'src/deleted.ts', line: 8, behavior: 'deleted line' }],
  };
  const report = { ...clone(REPORT), findings: [clone(FINDING), bodyOnlyFinding] };
  const gates = {
    ...clone(COMMENT_GATES),
    findings: [{ id: 'BRB001' }, { id: 'BRB002' }],
  };
  const diff = [
    '--- a/src/paging.ts',
    '+++ b/src/paging.ts',
    '@@ -42 +42 @@',
    '-old line',
    '+new line',
  ].join('\n');
  const submission = sourceSubmission(report, diff, gates);
  let payload;
  const execute = async (_command, args) => {
    if (args[0] === 'pr') return matchingHeadResponse();
    payload = JSON.parse(await readFile(args.at(-1), 'utf8'));
    return { stdout: JSON.stringify({ id: 9, html_url: REVIEW_URL }) };
  };

  await submitReview({
    ...submission,
    execute,
  });

  assert.match(payload.body, /src\/deleted\.ts:8/);
  assert.deepEqual(payload.comments.map(({ path, line }) => ({ path, line })), [
    { path: 'src/paging.ts', line: 42 },
  ]);
});

test('submitReview rejects an incomplete report head before GitHub', async () => {
  const execute = fakeExecute([]);
  await assert.rejects(
    submitReview({
      ...sourceSubmission(APPROVE_REPORT, '', APPROVE_GATES),
      report: { ...clone(APPROVE_REPORT), headSha: HEAD_SHA.slice(0, 12) },
      execute,
    }),
    /full 40-character/i,
  );
  assert.equal(execute.calls.length, 0);
});

test('submitReview cleans its temporary payload after gh fails', async () => {
  const submission = sourceSubmission(APPROVE_REPORT, '', APPROVE_GATES);
  let payloadFile;
  const execute = async (_command, args) => {
    if (args[0] === 'pr') return matchingHeadResponse();
    payloadFile = args.at(-1);
    throw new Error('GitHub rejected the review');
  };

  await assert.rejects(
    submitReview({
      ...submission,
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
  const diffFile = join(directory, 'pr.diff');
  const gatesFile = join(directory, 'gates.json');
  const outputFile = join(directory, 'body.md');
  const commentsFile = join(directory, 'comments.json');
  await writeFile(reportFile, JSON.stringify(REPORT), 'utf8');
  await writeFile(diffFile, '', 'utf8');
  await writeFile(gatesFile, JSON.stringify(COMMENT_GATES), 'utf8');
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
      '--report-file', reportFile,
      '--diff-file', diffFile,
      '--gates-file', gatesFile,
      '--body-file', join(directory, 'missing-body.md'),
      '--comments-file', commentsFile,
    ], { execute }),
    /ENOENT/,
  );
  assert.equal(execute.calls.length, 0);
});

test('main prepare consumes report and unified diff and writes body plus comments without gh', async () => {
  const reportFile = resolve('/mock/report.json');
  const diffFile = resolve('/mock/pr.diff');
  const gatesFile = resolve('/mock/gates.json');
  const bodyOutput = resolve('/mock/body.md');
  const commentsOutput = resolve('/mock/comments.json');
  const diff = [
    '--- a/src/paging.ts',
    '+++ b/src/paging.ts',
    '@@ -42 +42 @@',
    '-old line',
    '+new line',
  ].join('\n');
  const inputs = new Map([
    [reportFile, JSON.stringify(REPORT)],
    [diffFile, diff],
    [gatesFile, JSON.stringify(COMMENT_GATES)],
  ]);
  const writes = [];
  let executions = 0;

  await main([
    'prepare',
    '--report-file', reportFile,
    '--diff-file', diffFile,
    '--gates-file', gatesFile,
    '--body-output', bodyOutput,
    '--comments-output', commentsOutput,
  ], {
    readFile: async (path) => inputs.get(path),
    writeFile: async (...args) => writes.push(args),
    execute: async () => {
      executions += 1;
      throw new Error('prepare must not execute gh');
    },
  });

  assert.equal(executions, 0);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(([path, , encoding]) => [path, encoding]), [
    [bodyOutput, 'utf8'],
    [commentsOutput, 'utf8'],
  ]);
  assert.match(writes[0][1], /<!-- blast-radius-buddy-review:/);
  const comments = JSON.parse(writes[1][1]);
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, REVIEW_LINKAGE_MARKER);
});

test('main submit consumes source artifacts and checks the head before its only POST', async () => {
  const reportFile = resolve('/mock/report.json');
  const diffFile = resolve('/mock/pr.diff');
  const gatesFile = resolve('/mock/gates.json');
  const bodyFile = resolve('/mock/body.md');
  const commentsFile = resolve('/mock/comments.json');
  const submission = sourceSubmission(APPROVE_REPORT, '', APPROVE_GATES);
  const inputs = new Map([
    [reportFile, JSON.stringify(APPROVE_REPORT)],
    [diffFile, ''],
    [gatesFile, JSON.stringify(APPROVE_GATES)],
    [bodyFile, submission.body],
    [commentsFile, JSON.stringify(submission.comments)],
  ]);
  const operations = [];
  let stdout = '';
  const execute = async (_command, args) => {
    if (args[0] === 'pr') {
      operations.push(args);
      return matchingHeadResponse();
    }
    operations.push(args.slice(0, 4));
    return { stdout: JSON.stringify({ id: 9, html_url: REVIEW_URL }) };
  };

  const result = await main([
    'submit',
    '--repo', 'acme/widget',
    '--pr', '19',
    '--report-file', reportFile,
    '--diff-file', diffFile,
    '--gates-file', gatesFile,
    '--body-file', bodyFile,
    '--comments-file', commentsFile,
  ], {
    readFile: async (path) => inputs.get(path),
    execute,
    writeStdout: (value) => { stdout += value; },
  });

  assert.deepEqual(result, { reviewId: 9, reviewUrl: REVIEW_URL });
  assert.deepEqual(operations, [
    ['pr', 'view', '19', '--repo', 'acme/widget', '--json', 'headRefOid'],
    ['api', '--method', 'POST', 'repos/acme/widget/pulls/19/reviews'],
  ]);
  assert.deepEqual(JSON.parse(stdout), result);
});

test('main submit rejects a prepared-event-only command before reads or GitHub calls', async () => {
  const execute = fakeExecute([]);
  let reads = 0;

  await assert.rejects(
    main([
      'submit',
      '--repo', 'acme/widget',
      '--pr', '19',
      '--prepared-event-file', '/mock/forged.json',
      '--body-file', '/mock/body.md',
      '--comments-file', '/mock/comments.json',
    ], {
      readFile: async () => {
        reads += 1;
        throw new Error('must not read');
      },
      execute,
    }),
    /Usage:/,
  );
  assert.equal(reads, 0);
  assert.equal(execute.calls.length, 0);
});
