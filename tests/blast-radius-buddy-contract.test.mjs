import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { collectChangedLines } from '../skills/blast-radius-buddy/scripts/github-review.mjs';

const root = new URL('../', import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

test('documents the native high-signal PR review contract', async () => {
  const [skill, angles, prompts, report, validation, readme, scenario] = await Promise.all([
    read('skills/blast-radius-buddy/SKILL.md'),
    read('skills/blast-radius-buddy/references/review-angles.md'),
    read('skills/blast-radius-buddy/references/reviewer-prompts.md'),
    read('skills/blast-radius-buddy/references/github-report.md'),
    read('skills/blast-radius-buddy/references/validation.md'),
    read('README.md'),
    read('tests/scenarios/blast-radius-buddy.md'),
  ]);

  assert.match(skill, /URL, number, or current branch/i);
  assert.match(skill, /exact head SHA/i);
  assert.match(skill, /critical.*high.*meaningful.*medium/is);
  assert.match(skill, /exactly three/i);
  assert.match(skill, /one fresh-eyes/i);
  assert.match(skill, /APPROVE/);
  assert.match(skill, /never.*REQUEST_CHANGES/is);
  assert.match(skill, /cross-run duplicate suppression.*host semantic judgment.*complete prior-feedback ledger/is);
  assert.match(
    skill,
    /submit.*report.*diff.*verification.*gate.*recheck.*head.*write boundary/is,
  );
  assert.match(skill, /Do not add tests, edit production code, apply fixes, commit, or push/i);
  assert.match(skill, /safe to ignore indefinitely/i);
  assert.match(angles, /at most one.*suggestion.*per angle/is);
  assert.match(angles, /style.*naming.*formatting.*omit/is);
  assert.match(angles, /every suggestion.*PR-relative new-side changed line/is);
  assert.match(validation, /keep.*promote.*drop/is);
  assert.match(report, /careful shake/);
  assert.match(report, /here's what held and what came loose/);
  assert.match(report, /Non-blocking suggestions/);
  assert.match(report, /Approve.*suggestions.*findings.*deferred/is);
  assert.match(report, /suggestions.*at most 3/is);
  assert.match(validation, /confirmed.*narrowed.*downgraded.*unclear.*refuted/is);
  assert.match(
    angles,
    /--angle.*assigned angle.*exactly one reporter.*matching.*assigned angle/is,
  );
  assert.match(
    angles,
    /security-and-abuse.*system-blast-radius.*feature-truth-and-adjacent-regressions/is,
  );
  assert.match(angles, /synthesi[sz]ed.*multiple.*unique.*approved.*angle/is);
  assert.match(
    prompts,
    /retry.*only.*timeout.*malformed.*protocol.*validation.*launch.*authentication.*permission.*model.*not retried/is,
  );
  assert.match(
    validation,
    /confirmed.*actionable.*narrowed.*actionable.*downgraded.*actionable.*drop.*unclear.*deferred.*refuted.*drop/is,
  );
  assert.match(
    validation,
    /--expected-ids-file.*non-empty.*unique.*omission.*extra/is,
  );
  assert.match(
    validation,
    /verification.*--expected-ids-file.*complete.*BRS.*may be empty.*unique.*omission.*extra.*duplicate/is,
  );
  assert.match(
    prompts,
    /reproduction-checkout\.mjs classify.*--expected-ids-file.*--evidence-output.*--output.*--.*COMMAND/is,
  );
  assert.match(prompts, /captured diagnostic evidence.*untrusted.*tool-less classifier/is);
  assert.match(
    prompts,
    /First-pass recipe[\s\S]*one fenced `brb-review` block, with no prose before or after it/i,
  );
  assert.match(
    prompts,
    /Reproduction recipe[\s\S]*one fenced `brb-reproduction` block, with no prose before or after it/i,
  );
  assert.match(
    prompts,
    /Fresh-eyes recipe[\s\S]*one fenced `brb-verification` block, with no prose before or after it/i,
  );
  assert.match(
    prompts,
    /Fresh-eyes recipe[\s\S]*complete.*BRS[\s\S]*brb-verification[\s\S]*--expected-ids-file/is,
  );
  assert.match(validation, /clean.*BRS.*drop.*removes.*recompute.*APPROVE/is);
  assert.match(validation, /clean.*reject.*BRS.*actionable.*deferred.*BRB.*approval/is);
  assert.match(
    report,
    /github-review\.mjs prepare.*--report-file.*--diff-file.*--gates-file.*--verification-file.*--body-output.*--comments-output/is,
  );
  assert.match(
    report,
    /github-review\.mjs submit.*--report-file.*--diff-file.*--gates-file.*--verification-file.*--body-file.*--comments-file/is,
  );
  assert.doesNotMatch(report, /PREPARED_EVENT|prepared event artifact|--event-output/i);
  assert.match(report, /review-linkage fingerprint.*same GitHub review/is);
  assert.match(report, /cross-run duplicate suppression.*host semantic judgment.*complete ledger/is);
  assert.match(
    report,
    /submit.*recomputes.*REPORT.*DIFF.*GATES.*VERIFICATION.*head.*immediately before.*POST/is,
  );
  assert.match(report, /prepare.*deterministic.*does not.*GitHub/is);
  assert.match(
    report,
    /promotions.*suggestionId.*finding.*full normalized.*exact/is,
  );
  assert.match(
    scenario,
    /### Revised run[\s\S]*VERIFICATION\.json[\s\S]*"result"[\s\S]*"suggestions"[\s\S]*"promotions": \[\]/i,
  );
  assert.doesNotMatch(skill, /repair loop/i);
  assert.ok(skill.trim().split(/\s+/).length < 700, 'SKILL.md must stay below 700 words');
  assert.doesNotMatch(readme, /accepted findings[^.\n]*fix/i);
  assert.match(readme, /does not authorize code edits, commits, pushes/i);
  assert.match(readme, /host-selected diagnostic.*isolated checkout.*tool-less classification/is);
  assert.match(readme, /cross-run duplicates.*host semantic judgment.*complete ledger/is);
});

test('ships every deterministic PR review helper', async () => {
  const scripts = [
    'github-pr.mjs',
    'github-review.mjs',
    'reproduction-checkout.mjs',
    'review-comment.mjs',
    'review-history.mjs',
    'review-protocol.mjs',
    'reviewer-runner.mjs',
  ];

  await Promise.all(
    scripts.map((script) => access(new URL(`skills/blast-radius-buddy/scripts/${script}`, root))),
  );
});

test('the clean forward-test fixture has no hidden cache contract ambiguity', async () => {
  const fixture = await read('tests/fixtures/blast-radius-buddy/clean-pr.md');

  assert.match(fixture, /bounded TTL cache/i);
  assert.match(fixture, /maximum of 10,000 entries/i);
  assert.match(fixture, /JSON\.stringify\(\[user\.id, resource\.id\]\)/);
  assert.match(fixture, /cached !== undefined/);
});

test('the approval-suggestion fixture is neutral and carries a valid changed-line anchor', async () => {
  const fixture = await read(
    'tests/fixtures/blast-radius-buddy/approve-with-suggestion.md',
  );
  const diff = fixture.match(/```diff\n([\s\S]*?)\n```/)?.[1];

  assert.doesNotMatch(fixture, /^#.*(?:approve|suggestion)/im);
  assert.ok(diff, 'fixture must contain one fenced diff');
  assert.equal(
    collectChangedLines(diff).get('src/exports/complete-export.ts')?.has(49),
    true,
    'the optional exportType improvement must have a valid new-side changed-line anchor',
  );
});

test('documents the exact normalized REPORT.json consumed by prepare', async () => {
  const report = await read('skills/blast-radius-buddy/references/github-report.md');
  const match = report.match(
    /## Normalized REPORT\.json[\s\S]*?```json\n([\s\S]*?)\n```/,
  );

  assert.ok(match, 'github-report.md must contain a valid normalized REPORT.json example');
  const value = JSON.parse(match[1]);
  assert.deepEqual(Object.keys(value), [
    'verdict',
    'headSha',
    'findings',
    'suggestions',
    'priorFeedback',
    'validation',
    'deferred',
    'coverage',
  ]);
  assert.deepEqual(Object.keys(value.findings[0]), [
    'id',
    'severity',
    'confidence',
    'title',
    'what',
    'why',
    'impact',
    'evidence',
    'suggestedFix',
    'suggestedChange',
    'mechanical',
  ]);
  assert.deepEqual(Object.keys(value.findings[0].evidence[0]), [
    'path',
    'line',
    'behavior',
  ]);
  assert.deepEqual(Object.keys(value.suggestions[0]), [
    'id',
    'confidence',
    'title',
    'improvement',
    'benefit',
    'evidence',
    'suggestedChange',
    'mechanical',
  ]);
  assert.equal(value.suggestions[0].id, 'BRS001');
  assert.deepEqual(Object.keys(value.suggestions[0].evidence[0]), [
    'path',
    'line',
    'behavior',
  ]);
  assert.deepEqual(Object.keys(value.priorFeedback[0]), [
    'id',
    'status',
    'summary',
    'path',
    'line',
  ]);
  assert.deepEqual(Object.keys(value.coverage), [
    'security',
    'blastRadius',
    'featureTruth',
  ]);
  assert.match(
    report,
    /verdict.*`Approve`.*`Actionable findings`.*`Review completed with uncertainty`/is,
  );
  assert.match(report, /headSha.*full 40-character hexadecimal/i);
  assert.match(report, /every field.*required.*do not add/i);
});

test('documents exact first-pass review, verification, and gate suggestion schemas', async () => {
  const [angles, report] = await Promise.all([
    read('skills/blast-radius-buddy/references/review-angles.md'),
    read('skills/blast-radius-buddy/references/github-report.md'),
  ]);
  const reviewMatch = angles.match(
    /## Output contract[\s\S]*?```brb-review\n([\s\S]*?)\n```/,
  );
  const gateMatch = report.match(
    /## Native review[\s\S]*?```json\n([\s\S]*?)\n```/,
  );
  const verificationMatch = report.match(
    /## Verification artifact[\s\S]*?```json\n([\s\S]*?)\n```/,
  );

  assert.ok(reviewMatch, 'review-angles.md must contain a valid completed review example');
  assert.ok(verificationMatch, 'github-report.md must contain a valid VERIFICATION.json example');
  assert.ok(gateMatch, 'github-report.md must contain a valid GATES.json example');
  const review = JSON.parse(reviewMatch[1]);
  const verification = JSON.parse(verificationMatch[1]);
  const gates = JSON.parse(gateMatch[1]);
  assert.deepEqual(Object.keys(review), ['status', 'findings', 'suggestions']);
  assert.deepEqual(Object.keys(review.suggestions[0]), [
    'angle',
    'confidence',
    'title',
    'improvement',
    'benefit',
    'evidence',
    'suggestedChange',
    'mechanical',
    'priorFeedback',
    'reporters',
  ]);
  assert.deepEqual(Object.keys(verification), ['result', 'suggestions', 'promotions']);
  assert.deepEqual(Object.keys(verification.result), ['verdict', 'challenges']);
  assert.deepEqual(Object.keys(verification.result.challenges[0]), [
    'target',
    'evidence',
    'reason',
    'reportEffect',
  ]);
  assert.deepEqual(verification.suggestions[0], {
    id: 'BRS001',
    confidence: 'high',
    title: 'Include the export type in telemetry',
    improvement: 'Attach the available export type to the completion event.',
    benefit: 'Duration dashboards can be segmented without changing export behavior.',
    evidence: [{
      path: 'src/export.ts',
      line: 24,
      behavior: 'The export type is already in scope at the event call.',
    }],
    suggestedChange: 'track("export.completed", { durationMs, type });',
    mechanical: true,
  });
  assert.deepEqual(verification.promotions, []);
  assert.deepEqual(Object.keys(gates), [
    'reviewersComplete',
    'reproductionComplete',
    'materialUncertainty',
    'verifierVerdict',
    'findings',
    'suggestions',
    'failedRequiredChecks',
    'headUnchanged',
  ]);
  assert.deepEqual(gates.suggestions, [{ id: 'BRS001' }]);
});
