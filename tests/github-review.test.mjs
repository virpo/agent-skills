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
const SUGGESTION_LINKAGE_MARKER = /<!-- blast-radius-buddy-suggestion:BRS001:BRBK1_[0-9a-f]{64} -->$/;

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

const REPORT_SUGGESTION = {
  id: 'BRS001',
  confidence: 'high',
  title: 'Include the export type in telemetry',
  improvement: 'Attach the available export type to the completion event.',
  benefit: 'Duration dashboards can be segmented without changing export behavior.',
  evidence: [{ path: 'src/export.ts', line: 24, behavior: 'The type is already in scope.' }],
  suggestedChange: 'track("export.completed", { durationMs, type });',
  mechanical: true,
};

const SUGGESTION_DIFF = [
  '--- a/src/export.ts',
  '+++ b/src/export.ts',
  '@@ -24 +24 @@',
  '-track("export.completed", { durationMs });',
  '+track("export.completed", { durationMs, type });',
].join('\n');

const REPORT = {
  verdict: 'Actionable findings',
  headSha: HEAD_SHA,
  findings: [FINDING],
  suggestions: [],
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
  suggestions: [],
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
  suggestions: [],
  failedRequiredChecks: [],
  headUnchanged: true,
};

const COMMENT_VERIFICATION = {
  result: { verdict: 'uphold', challenges: [] },
  suggestions: [],
  promotions: [],
};

const APPROVE_VERIFICATION = {
  result: { verdict: 'clean', challenges: [] },
  suggestions: [],
  promotions: [],
};

const SUGGESTION_VERIFICATION = {
  result: {
    verdict: 'clean',
    challenges: [{
      target: 'BRS001',
      evidence: 'The optional telemetry dimension is supported by the changed code.',
      reason: 'The suggestion survives fresh-eyes verification unchanged.',
      reportEffect: 'none',
    }],
  },
  suggestions: [REPORT_SUGGESTION],
  promotions: [],
};

function clone(value) {
  return structuredClone(value);
}

function forgedArtifactHash(event, kind, contents) {
  return createHash('sha256')
    .update(`1\0${HEAD_SHA}\0${event}\0${kind}\0${contents}`)
    .digest('hex');
}

function sourceSubmission(report, diff, gates, verification) {
  const prepared = prepareReview(
    clone(report),
    diff,
    clone(gates),
    clone(verification),
  );
  return {
    repo: 'acme/widget',
    number: 19,
    report: clone(report),
    diff,
    gates: clone(gates),
    verification: clone(verification),
    body: prepared.body,
    comments: prepared.comments,
  };
}

function suggestionSubmission() {
  return sourceSubmission(
    { ...clone(APPROVE_REPORT), suggestions: [clone(REPORT_SUGGESTION)] },
    SUGGESTION_DIFF,
    { ...clone(APPROVE_GATES), suggestions: [{ id: 'BRS001' }] },
    SUGGESTION_VERIFICATION,
  );
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
    [without(REPORT, 'suggestions'), /report\.suggestions is required/],
    [{ ...clone(REPORT), suggestions: {} }, /report\.suggestions must be an array/],
    [{
      ...clone(APPROVE_REPORT),
      suggestions: [{ ...clone(REPORT_SUGGESTION), extra: true }],
    }, /suggestions\[0\] has unexpected field extra/],
    [{
      ...clone(APPROVE_REPORT),
      suggestions: [{ ...clone(REPORT_SUGGESTION), confidence: 'medium' }],
    }, /suggestions\[0\]\.confidence/],
    [{
      ...clone(APPROVE_REPORT),
      suggestions: [without(REPORT_SUGGESTION, 'benefit')],
    }, /suggestions\[0\]\.benefit is required/],
    [{
      ...clone(APPROVE_REPORT),
      suggestions: Array.from({ length: 4 }, (_, index) => ({
        ...clone(REPORT_SUGGESTION),
        id: `BRS00${index + 1}`,
      })),
    }, /suggestions.*at most 3/i],
    [{
      ...clone(APPROVE_REPORT),
      suggestions: [clone(REPORT_SUGGESTION), clone(REPORT_SUGGESTION)],
    }, /duplicate suggestion ID BRS001/],
    [{
      ...clone(APPROVE_REPORT),
      suggestions: [{ ...clone(REPORT_SUGGESTION), id: 'BRB001' }],
    }, /suggestions\[0\]\.id.*stable suggestion ID/i],
    [{
      ...clone(APPROVE_REPORT),
      suggestions: [{
        ...clone(REPORT_SUGGESTION),
        evidence: [{ path: '../outside', line: 24, behavior: 'out of bounds' }],
      }],
    }, /suggestions\[0\]\.evidence\[0\]\.path/],
    [{
      ...clone(APPROVE_REPORT),
      suggestions: [{ ...clone(REPORT_SUGGESTION), suggestedChange: null }],
    }, /suggestedChange.*mechanical/i],
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
    [{
      ...clone(APPROVE_REPORT),
      findings: [clone(FINDING)],
      suggestions: [clone(REPORT_SUGGESTION)],
    }, /Approve.*findings/i],
    [{
      ...clone(APPROVE_REPORT),
      suggestions: [clone(REPORT_SUGGESTION)],
      deferred: ['Unresolved behavior.'],
    }, /Approve.*deferred/i],
    [{ ...clone(REPORT), findings: [] }, /Actionable findings.*finding/i],
    [{ ...clone(APPROVE_REPORT), verdict: 'Review completed with uncertainty' }, /uncertainty.*deferred/i],
  ];

  for (const [report, error] of invalidReports) {
    assert.throws(() => buildReviewBody(report), error);
  }
});

test('Approve reports may contain verified non-blocking suggestions', () => {
  const report = { ...clone(APPROVE_REPORT), suggestions: [clone(REPORT_SUGGESTION)] };
  const gates = { ...clone(APPROVE_GATES), suggestions: [{ id: 'BRS001' }] };
  const prepared = prepareReview(report, SUGGESTION_DIFF, gates, SUGGESTION_VERIFICATION);

  assert.equal(prepared.event, 'APPROVE');
  assert.match(prepared.body, /## Non-blocking suggestions/);
  assert.match(prepared.body, /### BRS001 · Include the export type in telemetry/);
  assert.match(prepared.body, /- Improvement: Attach the available export type/);
  assert.match(prepared.body, /- Benefit: Duration dashboards can be segmented/);
  assert.match(prepared.body, /- Evidence: `src\/export\.ts:24` — The type is already in scope\./);
  assert.equal(prepared.comments.length, 1);
  assert.match(prepared.comments[0].body, /Non-blocking suggestion/);
  assert.match(prepared.comments[0].body, SUGGESTION_LINKAGE_MARKER);
});

test('prepareReview requires exact report and gate suggestion ID parity', () => {
  const report = { ...clone(APPROVE_REPORT), suggestions: [clone(REPORT_SUGGESTION)] };

  for (const suggestions of [[], [{ id: 'BRS002' }]]) {
    assert.throws(
      () => prepareReview(
        report,
        SUGGESTION_DIFF,
        { ...clone(APPROVE_GATES), suggestions },
        SUGGESTION_VERIFICATION,
      ),
      /report suggestions must match gate suggestions/i,
    );
  }
});

test('prepareReview binds fresh-eyes classifications and exact suggestion content', () => {
  const report = { ...clone(APPROVE_REPORT), suggestions: [clone(REPORT_SUGGESTION)] };
  const gates = { ...clone(APPROVE_GATES), suggestions: [{ id: 'BRS001' }] };
  const challenge = (reportEffect) => ({
    target: 'BRS001',
    evidence: 'Fresh eyes classified the exact normalized suggestion snapshot.',
    reason: `The suggestion has report effect ${reportEffect}.`,
    reportEffect,
  });
  const artifact = (
    verdict,
    challenges,
    suggestions = [REPORT_SUGGESTION],
    promotions = [],
  ) => ({
    result: { verdict, challenges },
    suggestions: clone(suggestions),
    promotions: clone(promotions),
  });

  assert.throws(
    () => prepareReview(report, SUGGESTION_DIFF, gates),
    /verification.*required/i,
  );
  assert.throws(
    () => prepareReview(
      report,
      SUGGESTION_DIFF,
      gates,
      artifact('clean', [challenge('drop')]),
    ),
    /suggestions.*verification|drop/i,
  );
  assert.throws(
    () => prepareReview(
      {
        ...clone(APPROVE_REPORT),
        suggestions: [{ ...clone(REPORT_SUGGESTION), benefit: 'Changed after verification.' }],
      },
      SUGGESTION_DIFF,
      gates,
      artifact('clean', [challenge('none')]),
    ),
    /suggestions.*verification|content/i,
  );
  assert.throws(
    () => prepareReview(
      report,
      SUGGESTION_DIFF,
      gates,
      artifact('clean', []),
    ),
    /missing expected ID BRS001/i,
  );
  assert.throws(
    () => prepareReview(
      report,
      SUGGESTION_DIFF,
      gates,
      artifact('clean', [challenge('none')], [REPORT_SUGGESTION, REPORT_SUGGESTION]),
    ),
    /duplicate suggestion ID BRS001/i,
  );
  assert.throws(
    () => prepareReview(
      {
        ...clone(APPROVE_REPORT),
        suggestions: [{ ...clone(REPORT_SUGGESTION), id: 'BRS002' }],
      },
      SUGGESTION_DIFF,
      { ...clone(APPROVE_GATES), suggestions: [{ id: 'BRS002' }] },
      artifact('clean', [challenge('none')]),
    ),
    /suggestions.*verification|unexpected/i,
  );

  assert.throws(
    () => prepareReview(
      clone(APPROVE_REPORT),
      '',
      clone(APPROVE_GATES),
      COMMENT_VERIFICATION,
    ),
    /verifier verdict.*verification|verification.*verdict/i,
  );
});

test('prepareReview accepts a clean keep bound to the exact suggestion snapshot', () => {
  const prepared = prepareReview(
    { ...clone(APPROVE_REPORT), suggestions: [clone(REPORT_SUGGESTION)] },
    SUGGESTION_DIFF,
    { ...clone(APPROVE_GATES), suggestions: [{ id: 'BRS001' }] },
    clone(SUGGESTION_VERIFICATION),
  );

  assert.equal(prepared.event, 'APPROVE');
  assert.equal(prepared.comments.length, 1);
  assert.match(prepared.comments[0].body, SUGGESTION_LINKAGE_MARKER);
});

function actionableSuggestionChallenge(target) {
  return {
    target,
    evidence: `${target} describes a defect rather than an optional improvement.`,
    reason: `${target} must be promoted to an actionable finding.`,
    reportEffect: 'actionable',
  };
}

function promotedVerification({
  suggestions = [REPORT_SUGGESTION],
  promotions = [{ suggestionId: 'BRS001', finding: FINDING }],
} = {}) {
  return {
    result: {
      verdict: 'modify',
      challenges: suggestions.map(({ id }) => actionableSuggestionChallenge(id)),
    },
    suggestions: clone(suggestions),
    promotions: clone(promotions),
  };
}

function promotedReport(finding = FINDING) {
  return {
    ...clone(REPORT),
    findings: [clone(finding)],
    suggestions: [],
    deferred: [],
  };
}

function promotedGates(findingId = 'BRB001') {
  return {
    ...clone(COMMENT_GATES),
    materialUncertainty: false,
    verifierVerdict: 'modify',
    findings: [{ id: findingId }],
  };
}

test('prepareReview accepts one exact promotion for one actionable suggestion', () => {
  const prepared = prepareReview(
    promotedReport(),
    '',
    promotedGates(),
    promotedVerification(),
  );

  assert.equal(prepared.event, 'COMMENT');
  assert.match(prepared.body, /BRB001/);
});

test('prepareReview rejects an unrelated report finding for an actionable promotion', () => {
  const unrelated = {
    ...clone(FINDING),
    id: 'BRB002',
    title: 'An unrelated actionable failure',
    what: 'A separate path returns an incorrect result.',
  };

  assert.throws(
    () => prepareReview(
      promotedReport(unrelated),
      '',
      promotedGates('BRB002'),
      promotedVerification(),
    ),
    /promoted finding BRB001.*match.*report/i,
  );
});

test('prepareReview requires one promotion for every actionable suggestion', () => {
  assert.throws(
    () => prepareReview(
      promotedReport(),
      '',
      promotedGates(),
      promotedVerification({ promotions: [] }),
    ),
    /promotions.*missing.*BRS001/i,
  );
});

test('prepareReview rejects extra and duplicate suggestion promotions', () => {
  for (const [promotions, error] of [
    [[{ suggestionId: 'BRS001', finding: FINDING }], /promotions.*unexpected.*BRS001/i],
    [[
      { suggestionId: 'BRS001', finding: FINDING },
      { suggestionId: 'BRS001', finding: { ...clone(FINDING), id: 'BRB002' } },
    ], /promotions.*duplicate suggestion ID BRS001/i],
  ]) {
    assert.throws(
      () => prepareReview(
        { ...clone(APPROVE_REPORT), suggestions: [clone(REPORT_SUGGESTION)] },
        SUGGESTION_DIFF,
        { ...clone(APPROVE_GATES), suggestions: [{ id: 'BRS001' }] },
        {
          ...clone(SUGGESTION_VERIFICATION),
          promotions,
        },
      ),
      error,
    );
  }
});

test('prepareReview rejects two actionable suggestions mapped to one finding', () => {
  const secondSuggestion = {
    ...clone(REPORT_SUGGESTION),
    id: 'BRS002',
    title: 'Include a second telemetry dimension',
  };

  assert.throws(
    () => prepareReview(
      promotedReport(),
      '',
      promotedGates(),
      promotedVerification({
        suggestions: [REPORT_SUGGESTION, secondSuggestion],
        promotions: [
          { suggestionId: 'BRS001', finding: FINDING },
          { suggestionId: 'BRS002', finding: FINDING },
        ],
      }),
    ),
    /promotions.*duplicate finding ID BRB001/i,
  );
});

test('prepareReview rejects promoted finding content changed after verification', () => {
  assert.throws(
    () => prepareReview(
      promotedReport({ ...clone(FINDING), impact: 'Changed after verification.' }),
      '',
      promotedGates(),
      promotedVerification(),
    ),
    /promoted finding BRB001.*match.*report/i,
  );
});

test('prepareReview rejects a surviving suggestion without a changed-line anchor', () => {
  const report = { ...clone(APPROVE_REPORT), suggestions: [clone(REPORT_SUGGESTION)] };
  const gates = { ...clone(APPROVE_GATES), suggestions: [{ id: 'BRS001' }] };
  const diffWithoutSuggestionLine = [
    '--- a/src/export.ts',
    '+++ b/src/export.ts',
    '@@ -25 +25 @@',
    '-old line',
    '+new line',
  ].join('\n');

  assert.throws(
    () => prepareReview(
      report,
      diffWithoutSuggestionLine,
      gates,
      SUGGESTION_VERIFICATION,
    ),
    /suggestions\[0\].*PR-relative new-side changed line/i,
  );
});

test('prepareReview derives the event and head from explicit host gates', () => {
  const diff = [
    '--- a/src/paging.ts',
    '+++ b/src/paging.ts',
    '@@ -42 +42 @@',
    '-old line',
    '+new line',
  ].join('\n');

  const prepared = prepareReview(
    clone(REPORT),
    diff,
    clone(COMMENT_GATES),
    clone(COMMENT_VERIFICATION),
  );

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
      () => prepareReview(clone(APPROVE_REPORT), '', gates, clone(APPROVE_VERIFICATION)),
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
    suggestions: [],
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

  const first = prepareReview(report, diff, gates, COMMENT_VERIFICATION);
  const second = prepareReview(
    clone(report),
    diff,
    clone(gates),
    clone(COMMENT_VERIFICATION),
  );

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

  const prepared = prepareReview(
    clone(REPORT),
    diff,
    clone(COMMENT_GATES),
    clone(COMMENT_VERIFICATION),
  );
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
    }, '', clone(COMMENT_GATES), clone(COMMENT_VERIFICATION)),
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
  const prepared = prepareReview(
    clone(REPORT),
    diff,
    clone(COMMENT_GATES),
    clone(COMMENT_VERIFICATION),
  );
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
    verification: clone(COMMENT_VERIFICATION),
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
  const submission = suggestionSubmission();
  const execute = fakeExecute([{
    stdout: JSON.stringify({ headRefOid: staleHeadSha }),
  }]);

  await assert.rejects(
    submitReview({
      ...submission,
      execute,
    }),
    /head changed.*abcdef.*123456/i,
  );
  assert.deepEqual(execute.calls.map(({ args }) => args[0]), ['pr']);
});

test('submitReview posts only COMMENT or APPROVE with the captured SHA', async () => {
  for (const event of ['COMMENT', 'APPROVE']) {
    const submission = event === 'APPROVE'
      ? sourceSubmission(APPROVE_REPORT, '', APPROVE_GATES, APPROVE_VERIFICATION)
      : sourceSubmission(REPORT, '', COMMENT_GATES, COMMENT_VERIFICATION);
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
  const submission = suggestionSubmission();
  for (const mismatch of [
    { body: `${submission.body}\nchanged`, comments: submission.comments },
    { body: submission.body, comments: [{ ...submission.comments[0], body: 'changed' }] },
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

test('submitReview rebinds the verification artifact before any GitHub call', async () => {
  const submission = suggestionSubmission();
  const execute = fakeExecute([]);

  await assert.rejects(
    submitReview({
      ...submission,
      verification: {
        ...clone(submission.verification),
        suggestions: [{
          ...clone(REPORT_SUGGESTION),
          improvement: 'Changed after the prepared artifacts were written.',
        }],
      },
      execute,
    }),
    /suggestions.*verification|content/i,
  );
  assert.equal(execute.calls.length, 0);
});

test('submitReview posts APPROVE with verified BRS inline comments', async () => {
  const submission = suggestionSubmission();
  let payload;
  const execute = async (_command, args) => {
    if (args[0] === 'pr') return matchingHeadResponse();
    payload = JSON.parse(await readFile(args.at(-1), 'utf8'));
    return { stdout: JSON.stringify({ id: 9, html_url: REVIEW_URL }) };
  };

  await submitReview({ ...submission, execute });

  assert.equal(payload.event, 'APPROVE');
  assert.equal(payload.comments.length, 1);
  assert.equal(payload.comments[0].side, 'RIGHT');
  assert.match(payload.comments[0].body, SUGGESTION_LINKAGE_MARKER);
});

test('submitReview writes the exact payload and removes its temporary file', async () => {
  const diff = [
    '--- a/src/paging.ts',
    '+++ b/src/paging.ts',
    '@@ -42 +42 @@',
    '-old line',
    '+new line',
  ].join('\n');
  const submission = sourceSubmission(REPORT, diff, COMMENT_GATES, COMMENT_VERIFICATION);
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
  const submission = sourceSubmission(report, diff, gates, COMMENT_VERIFICATION);
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
      ...sourceSubmission(APPROVE_REPORT, '', APPROVE_GATES, APPROVE_VERIFICATION),
      report: { ...clone(APPROVE_REPORT), headSha: HEAD_SHA.slice(0, 12) },
      execute,
    }),
    /full 40-character/i,
  );
  assert.equal(execute.calls.length, 0);
});

test('submitReview cleans its temporary payload after gh fails', async () => {
  const submission = sourceSubmission(
    APPROVE_REPORT,
    '',
    APPROVE_GATES,
    APPROVE_VERIFICATION,
  );
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
  const verificationFile = join(directory, 'verification.json');
  const outputFile = join(directory, 'body.md');
  const commentsFile = join(directory, 'comments.json');
  await writeFile(reportFile, JSON.stringify(REPORT), 'utf8');
  await writeFile(diffFile, '', 'utf8');
  await writeFile(gatesFile, JSON.stringify(COMMENT_GATES), 'utf8');
  await writeFile(verificationFile, JSON.stringify(COMMENT_VERIFICATION), 'utf8');
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
      '--verification-file', verificationFile,
      '--body-file', join(directory, 'missing-body.md'),
      '--comments-file', commentsFile,
    ], { execute }),
    /ENOENT/,
  );
  assert.equal(execute.calls.length, 0);
});

test('main prepare consumes all source artifacts and writes body plus comments without gh', async () => {
  const reportFile = resolve('/mock/report.json');
  const diffFile = resolve('/mock/pr.diff');
  const gatesFile = resolve('/mock/gates.json');
  const verificationFile = resolve('/mock/verification.json');
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
    [verificationFile, JSON.stringify(COMMENT_VERIFICATION)],
  ]);
  const writes = [];
  let executions = 0;

  await main([
    'prepare',
    '--report-file', reportFile,
    '--diff-file', diffFile,
    '--gates-file', gatesFile,
    '--verification-file', verificationFile,
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
  const verificationFile = resolve('/mock/verification.json');
  const bodyFile = resolve('/mock/body.md');
  const commentsFile = resolve('/mock/comments.json');
  const submission = sourceSubmission(
    APPROVE_REPORT,
    '',
    APPROVE_GATES,
    APPROVE_VERIFICATION,
  );
  const inputs = new Map([
    [reportFile, JSON.stringify(APPROVE_REPORT)],
    [diffFile, ''],
    [gatesFile, JSON.stringify(APPROVE_GATES)],
    [verificationFile, JSON.stringify(APPROVE_VERIFICATION)],
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
    '--verification-file', verificationFile,
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
