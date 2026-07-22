import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  assignStableIds,
  decideReviewEvent,
  main,
  parseProtocolBlock,
  selectReproductionCandidates,
  validateReproductionResult,
  validateReviewResult,
  validateVerificationResult,
} from '../skills/blast-radius-buddy/scripts/review-protocol.mjs';

const execFileAsync = promisify(execFile);

const FEATURE_ANGLE = 'feature-truth-and-adjacent-regressions';
const SECURITY_ANGLE = 'security-and-abuse';
const SYSTEM_ANGLE = 'system-blast-radius';

const FINDING = {
  angle: FEATURE_ANGLE,
  severity: 'medium',
  confidence: 'high',
  title: 'The final full page is skipped',
  what: 'Exactly divisible totals return one page too few.',
  why: 'The new floor division subtracts one before calculating the page count.',
  reachability: 'Any list where total % pageSize === 0.',
  impact: 'Users cannot reach the final page of results.',
  evidence: [{
    path: 'src/paging.ts',
    line: 42,
    behavior: 'Math.floor((total - 1) / pageSize)',
  }],
  suggestedFix: 'Use ceiling division for positive totals.',
  suggestedChange: null,
  mechanical: false,
  priorFeedback: null,
  reporters: [FEATURE_ANGLE],
  needsRuntimeProof: false,
  securitySensitive: false,
  deletionSensitive: false,
  scopeUncertain: false,
};

const CLEAN_GATES = {
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

function block(label, value) {
  return `\`\`\`${label}\n${JSON.stringify(value)}\n\`\`\``;
}

test('parseProtocolBlock accepts exactly one matching fenced JSON block', () => {
  const value = { status: 'complete', findings: [] };

  assert.deepEqual(parseProtocolBlock(`\n${block('brb-review', value)}\n`, 'brb-review'), value);

  const invalidOutputs = [
    `analysis first\n${block('brb-review', value)}`,
    `${block('brb-review', value)}\ntrailing prose`,
    `${block('brb-review', value)}\n${block('brb-review', value)}`,
    block('brb-verification', value),
    '```brb-review\n{invalid json}\n```',
  ];
  for (const output of invalidOutputs) {
    assert.throws(() => parseProtocolBlock(output, 'brb-review'));
  }
});

test('validateReviewResult accepts complete and needs-context envelopes', () => {
  const complete = { status: 'complete', findings: [FINDING] };
  const needsContext = {
    status: 'needs-context',
    missingContext: ['The generated route table is not present.'],
  };

  assert.deepEqual(validateReviewResult(complete, FEATURE_ANGLE), complete);
  assert.deepEqual(validateReviewResult(needsContext, FEATURE_ANGLE), needsContext);
  assert.throws(
    () => validateReviewResult({ ...complete, extra: true }, FEATURE_ANGLE),
    /unexpected field extra/,
  );
  assert.throws(
    () => validateReviewResult(
      { status: 'needs-context', missingContext: [] },
      FEATURE_ANGLE,
    ),
    /missingContext/,
  );
});

test('validateReviewResult binds every first-pass finding to its assigned angle and reporter', () => {
  const complete = { status: 'complete', findings: [FINDING] };

  assert.throws(() => validateReviewResult(complete), /expected angle/i);
  assert.throws(
    () => validateReviewResult(complete, SECURITY_ANGLE),
    /findings\[0\]\.angle.*assigned angle/i,
  );
  for (const reporters of [
    [],
    [SYSTEM_ANGLE],
    [FEATURE_ANGLE, SYSTEM_ANGLE],
    [FEATURE_ANGLE, FEATURE_ANGLE],
  ]) {
    assert.throws(
      () => validateReviewResult({
        status: 'complete',
        findings: [{ ...FINDING, reporters }],
      }, FEATURE_ANGLE),
      /findings\[0\]\.reporters.*exactly one.*assigned angle/i,
    );
  }

  assert.deepEqual(
    validateReviewResult(complete, FEATURE_ANGLE).findings[0].reporters,
    [FEATURE_ANGLE],
  );
});

test('validateReviewResult rejects every missing finding field', () => {
  for (const field of Object.keys(FINDING)) {
    const finding = clone(FINDING);
    delete finding[field];
    assert.throws(
      () => validateReviewResult(
        { status: 'complete', findings: [finding] },
        FEATURE_ANGLE,
      ),
      new RegExp(`findings\\[0\\]\\.${field}`),
    );
  }
});

test('validateReviewResult rejects unsupported angles, low-value severities, and low confidence', () => {
  const invalidFields = [
    ['angle', 'performance'],
    ['severity', 'low'],
    ['severity', 'nit'],
    ['confidence', 'low'],
  ];

  for (const [field, value] of invalidFields) {
    assert.throws(
      () => validateReviewResult({
        status: 'complete',
        findings: [{ ...FINDING, [field]: value }],
      }, FEATURE_ANGLE),
      new RegExp(`findings\\[0\\]\\.${field}`),
    );
  }
});

test('validateReviewResult rejects invalid repository paths and non-positive lines', () => {
  const invalidPaths = [
    '',
    '/etc/passwd',
    '../secrets.txt',
    'src/../secrets.txt',
    'src\\paging.ts',
    'src/\u0000paging.ts',
  ];
  for (const path of invalidPaths) {
    const finding = clone(FINDING);
    finding.evidence[0].path = path;
    assert.throws(
      () => validateReviewResult(
        { status: 'complete', findings: [finding] },
        FEATURE_ANGLE,
      ),
      /findings\[0\]\.evidence\[0\]\.path/,
    );
  }

  for (const line of [0, -1, 1.5, '42', Number.MAX_SAFE_INTEGER + 1]) {
    const finding = clone(FINDING);
    finding.evidence[0].line = line;
    assert.throws(
      () => validateReviewResult(
        { status: 'complete', findings: [finding] },
        FEATURE_ANGLE,
      ),
      /findings\[0\]\.evidence\[0\]\.line/,
    );
  }
});

test('validation preserves long structural paths and finding text without truncation', () => {
  const longPath = `src/${'deep-segment/'.repeat(30)}paging.ts`;
  const longTitle = `Pagination failure ${'x'.repeat(600)} TITLE-END`;
  const finding = clone(FINDING);
  finding.evidence[0].path = longPath;
  finding.title = longTitle;

  const result = validateReviewResult(
    { status: 'complete', findings: [finding] },
    FEATURE_ANGLE,
  );

  assert.equal(result.findings[0].evidence[0].path, longPath);
  assert.equal(result.findings[0].title, longTitle);
});

test('assignStableIds sorts by severity, path, line, and title without mutating input', () => {
  const later = {
    ...clone(FINDING),
    severity: 'medium',
    title: 'Zebra failure',
    evidence: [{ path: 'src/z.ts', line: 90, behavior: 'returns stale state' }],
  };
  const earlier = {
    ...clone(FINDING),
    severity: 'high',
    title: 'Alpha failure',
    evidence: [{ path: 'src/a.ts', line: 2, behavior: 'drops the write' }],
  };
  const input = [later, earlier];

  const assigned = assignStableIds(input);

  assert.deepEqual(assigned.map(({ id, title }) => ({ id, title })), [
    { id: 'BRB001', title: 'Alpha failure' },
    { id: 'BRB002', title: 'Zebra failure' },
  ]);
  assert.equal('id' in input[0], false);
  assert.equal('id' in input[1], false);
});

test('assignStableIds retains only unique approved multi-angle synthesis reporters', () => {
  const reporters = [FEATURE_ANGLE, SYSTEM_ANGLE];
  const [assigned] = assignStableIds([{ ...FINDING, reporters }]);

  assert.deepEqual(assigned.reporters, reporters);
  assert.throws(
    () => assignStableIds([{
      ...FINDING,
      reporters: [FEATURE_ANGLE, FEATURE_ANGLE],
    }]),
    /reporters.*unique/i,
  );
  assert.throws(
    () => assignStableIds([{ ...FINDING, reporters: [FEATURE_ANGLE, 'forged-angle'] }]),
    /reporters\[1\].*unsupported/i,
  );
});

test('selectReproductionCandidates selects single reports and skips direct two-angle agreement', () => {
  const [singleReporter] = assignStableIds([FINDING]);

  assert.deepEqual(
    selectReproductionCandidates([singleReporter]).map((item) => item.id),
    ['BRB001'],
  );
  assert.deepEqual(
    selectReproductionCandidates([{
      ...singleReporter,
      reporters: [FEATURE_ANGLE, SYSTEM_ANGLE],
    }]),
    [],
  );
});

test('selectReproductionCandidates requires complete direct evidence to skip and honors proof-risk flags', () => {
  const [finding] = assignStableIds([FINDING]);
  const agreed = { ...finding, reporters: [FEATURE_ANGLE, SYSTEM_ANGLE] };
  const withoutEvidence = { ...agreed, evidence: [] };
  const incompleteEvidence = {
    ...agreed,
    evidence: [{ path: 'src/paging.ts', line: 42, behavior: '' }],
  };

  assert.deepEqual(selectReproductionCandidates([withoutEvidence]).map(({ id }) => id), ['BRB001']);
  assert.deepEqual(selectReproductionCandidates([incompleteEvidence]).map(({ id }) => id), ['BRB001']);

  for (const flag of [
    'needsRuntimeProof',
    'securitySensitive',
    'deletionSensitive',
    'scopeUncertain',
  ]) {
    assert.deepEqual(
      selectReproductionCandidates([{ ...agreed, [flag]: true }]).map(({ id }) => id),
      ['BRB001'],
    );
  }
});

test('selectReproductionCandidates rejects forged and duplicate synthesis reporters', () => {
  const [finding] = assignStableIds([FINDING]);

  for (const reporters of [
    ['claimed-one', 'claimed-two'],
    [FEATURE_ANGLE, FEATURE_ANGLE],
  ]) {
    assert.throws(
      () => selectReproductionCandidates([{ ...finding, reporters }]),
      /reporters.*(?:unsupported|unique)/i,
    );
  }
});

test('validateReproductionResult enforces the exact reproduction schema', () => {
  const result = {
    results: [{
      id: 'BRB001',
      verdict: 'confirmed',
      severity: 'high',
      evidence: 'node --test reproduces the skipped final page.',
      reason: 'The result is deterministic at exact page boundaries.',
      reportEffect: 'actionable',
    }],
  };

  assert.deepEqual(validateReproductionResult(result), result);
  for (const [field, value] of [
    ['id', 'finding-1'],
    ['verdict', 'accepted'],
    ['severity', 'low'],
    ['evidence', ''],
    ['reason', null],
    ['reportEffect', 'approve'],
  ]) {
    const invalid = clone(result);
    invalid.results[0][field] = value;
    assert.throws(
      () => validateReproductionResult(invalid),
      new RegExp(`results\\[0\\]\\.${field}`),
    );
  }
  assert.throws(
    () => validateReproductionResult({ results: [{ ...result.results[0], extra: true }] }),
    /unexpected field extra/,
  );
});

test('validateReproductionResult enforces verdict and report-effect mappings', () => {
  const base = {
    id: 'BRB001',
    severity: 'medium',
    evidence: 'The supplied command produced a deterministic result.',
    reason: 'The classification follows the observed behavior.',
  };
  const valid = [
    ['confirmed', 'actionable'],
    ['narrowed', 'actionable'],
    ['downgraded', 'actionable'],
    ['downgraded', 'drop'],
    ['unclear', 'deferred'],
    ['refuted', 'drop'],
  ];
  for (const [verdict, reportEffect] of valid) {
    const result = { results: [{ ...base, verdict, reportEffect }] };
    assert.deepEqual(validateReproductionResult(result), result);
  }

  for (const [verdict, reportEffect] of [
    ['confirmed', 'drop'],
    ['narrowed', 'deferred'],
    ['downgraded', 'deferred'],
    ['unclear', 'actionable'],
    ['refuted', 'actionable'],
  ]) {
    assert.throws(
      () => validateReproductionResult({
        results: [{ ...base, verdict, reportEffect }],
      }),
      /reportEffect.*incompatible.*verdict/i,
    );
  }
});

test('validateVerificationResult enforces verdicts and stable challenge targets', () => {
  const result = {
    verdict: 'modify',
    challenges: [
      {
        target: 'BRB001',
        evidence: 'The failure is limited to positive page sizes.',
        reason: 'The original scope was too broad.',
        reportEffect: 'actionable',
      },
      {
        target: 'approval',
        evidence: 'A required check is still failing.',
        reason: 'The clean verdict is contradicted.',
        reportEffect: 'none',
      },
    ],
  };

  assert.deepEqual(validateVerificationResult(result), result);
  assert.throws(
    () => validateVerificationResult({ ...result, verdict: 'uncertain' }),
    /verdict/,
  );
  assert.throws(
    () => validateVerificationResult({
      ...result,
      challenges: [{ ...result.challenges[0], target: 'BRB1' }],
    }),
    /challenges\[0\]\.target/,
  );
  assert.throws(
    () => validateVerificationResult({ ...result, extra: true }),
    /unexpected field extra/,
  );
});

test('validateVerificationResult enforces fresh-eyes verdict and challenge semantics', () => {
  const challenge = {
    target: 'BRB001',
    evidence: 'Specific evidence changes the synthesized finding.',
    reason: 'The original classification needs a report change.',
    reportEffect: 'actionable',
  };
  const valid = [
    { verdict: 'uphold', challenges: [] },
    { verdict: 'uphold', challenges: [{ ...challenge, reportEffect: 'none' }] },
    { verdict: 'modify', challenges: [challenge] },
    { verdict: 'defer', challenges: [{ ...challenge, reportEffect: 'deferred' }] },
    { verdict: 'drop', challenges: [{ ...challenge, reportEffect: 'drop' }] },
    { verdict: 'clean', challenges: [] },
    { verdict: 'clean', challenges: [{ ...challenge, target: 'approval', reportEffect: 'none' }] },
  ];
  for (const result of valid) {
    assert.deepEqual(validateVerificationResult(result), result);
  }

  for (const result of [
    { verdict: 'uphold', challenges: [challenge] },
    { verdict: 'modify', challenges: [{ ...challenge, reportEffect: 'none' }] },
    { verdict: 'defer', challenges: [{ ...challenge, reportEffect: 'drop' }] },
    { verdict: 'drop', challenges: [{ ...challenge, reportEffect: 'actionable' }] },
    { verdict: 'clean', challenges: [challenge] },
  ]) {
    assert.throws(
      () => validateVerificationResult(result),
      /challenges.*incompatible.*verdict/i,
    );
  }
});

test('decideReviewEvent rejects missing and extra gate fields as marker-only', () => {
  for (const field of Object.keys(CLEAN_GATES)) {
    const gates = clone(CLEAN_GATES);
    delete gates[field];
    assert.throws(
      () => decideReviewEvent(gates),
      new Error('Review is incomplete; update the marker only'),
    );
  }

  assert.throws(
    () => decideReviewEvent({ ...CLEAN_GATES, extra: true }),
    new Error('Review is incomplete; update the marker only'),
  );
});

test('decideReviewEvent requires real booleans for every gate state', () => {
  for (const field of [
    'reviewersComplete',
    'reproductionComplete',
    'materialUncertainty',
    'headUnchanged',
  ]) {
    for (const value of ['false', 0, null]) {
      assert.throws(
        () => decideReviewEvent({ ...CLEAN_GATES, [field]: value }),
        new Error('Review is incomplete; update the marker only'),
      );
    }
  }
});

test('decideReviewEvent rejects invalid verdicts and non-array collection fields', () => {
  assert.throws(
    () => decideReviewEvent({ ...CLEAN_GATES, verifierVerdict: 'uncertain' }),
    new Error('Review is incomplete; update the marker only'),
  );

  for (const [field, value] of [
    ['findings', ''],
    ['findings', {}],
    ['findings', null],
    ['failedRequiredChecks', ''],
    ['failedRequiredChecks', {}],
    ['failedRequiredChecks', null],
  ]) {
    assert.throws(
      () => decideReviewEvent({ ...CLEAN_GATES, [field]: value }),
      new Error('Review is incomplete; update the marker only'),
    );
  }
});

test('decideReviewEvent validates collection members before choosing an event', () => {
  for (const finding of [null, 'finding', 42, false]) {
    assert.throws(
      () => decideReviewEvent({ ...CLEAN_GATES, findings: [finding] }),
      new Error('Review is incomplete; update the marker only'),
    );
  }
  for (const check of ['', '   ', null, 42, false]) {
    assert.throws(
      () => decideReviewEvent({ ...CLEAN_GATES, failedRequiredChecks: [check] }),
      new Error('Review is incomplete; update the marker only'),
    );
  }

  assert.equal(decideReviewEvent({ ...CLEAN_GATES, findings: [{}] }), 'COMMENT');
});

test('decideReviewEvent enforces marker-only, COMMENT, and APPROVE gates', () => {
  assert.equal(decideReviewEvent(CLEAN_GATES), 'APPROVE');
  assert.equal(decideReviewEvent({ ...CLEAN_GATES, findings: [FINDING] }), 'COMMENT');
  assert.equal(decideReviewEvent({ ...CLEAN_GATES, verifierVerdict: 'defer' }), 'COMMENT');
  assert.equal(decideReviewEvent({ ...CLEAN_GATES, materialUncertainty: true }), 'COMMENT');
  assert.equal(decideReviewEvent({ ...CLEAN_GATES, failedRequiredChecks: ['test'] }), 'COMMENT');

  for (const gates of [
    { ...CLEAN_GATES, headUnchanged: false },
    { ...CLEAN_GATES, reviewersComplete: false },
    { ...CLEAN_GATES, reproductionComplete: false },
  ]) {
    assert.throws(() => decideReviewEvent(gates), /marker only/);
  }
});

test('main validates protocol blocks, selects candidates, and decides events read-only', async () => {
  const assigned = assignStableIds([FINDING]);
  const inputs = new Map([
    ['review.txt', block('brb-review', { status: 'complete', findings: [FINDING] })],
    ['synthesis.json', JSON.stringify({ findings: assigned })],
    ['gates.json', JSON.stringify(CLEAN_GATES)],
  ]);
  const outputs = [];
  const dependencies = {
    readFile: async (path) => inputs.get(path),
    writeStdout: (value) => outputs.push(value),
  };

  await main([
    'validate',
    '--kind', 'review',
    '--angle', FEATURE_ANGLE,
    '--input', 'review.txt',
  ], dependencies);
  await main(['select-reproduction', '--input', 'synthesis.json'], dependencies);
  await main(['decide-event', '--input', 'gates.json'], dependencies);

  assert.deepEqual(outputs, [
    `${JSON.stringify({ status: 'complete', findings: [FINDING] })}\n`,
    `${JSON.stringify(assigned)}\n`,
    'APPROVE\n',
  ]);
});

test('select-reproduction CLI rejects forged reporter provenance', async () => {
  const [finding] = assignStableIds([FINDING]);
  const forged = {
    findings: [{ ...finding, reporters: ['claimed-one', 'claimed-two'] }],
  };
  let output = '';

  await assert.rejects(
    main(['select-reproduction', '--input', 'forged.json'], {
      readFile: async () => JSON.stringify(forged),
      writeStdout: (value) => { output += value; },
    }),
    /reporters\[0\].*unsupported/i,
  );
  assert.equal(output, '');
});

test('the executable exits non-zero with the marker-only error for invalid or incomplete gates', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'brb-protocol-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = fileURLToPath(
    new URL('../skills/blast-radius-buddy/scripts/review-protocol.mjs', import.meta.url),
  );

  const missingField = clone(CLEAN_GATES);
  delete missingField.materialUncertainty;
  const cases = [
    ['incomplete', { ...CLEAN_GATES, headUnchanged: false }],
    ['invalid', missingField],
  ];
  for (const [name, gates] of cases) {
    const input = join(directory, `${name}.json`);
    await writeFile(input, JSON.stringify(gates));
    await assert.rejects(
      execFileAsync(process.execPath, [script, 'decide-event', '--input', input]),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, '');
        assert.equal(error.stderr, 'Review is incomplete; update the marker only\n');
        return true;
      },
    );
  }
});
