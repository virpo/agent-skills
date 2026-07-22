import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

test('documents the native high-signal PR review contract', async () => {
  const [skill, angles, prompts, report, validation, readme] = await Promise.all([
    read('skills/blast-radius-buddy/SKILL.md'),
    read('skills/blast-radius-buddy/references/review-angles.md'),
    read('skills/blast-radius-buddy/references/reviewer-prompts.md'),
    read('skills/blast-radius-buddy/references/github-report.md'),
    read('skills/blast-radius-buddy/references/validation.md'),
    read('README.md'),
  ]);

  assert.match(skill, /URL, number, or current branch/i);
  assert.match(skill, /exact head SHA/i);
  assert.match(skill, /critical.*high.*meaningful.*medium/is);
  assert.match(skill, /exactly three/i);
  assert.match(skill, /one fresh-eyes/i);
  assert.match(skill, /APPROVE/);
  assert.match(skill, /never.*REQUEST_CHANGES/is);
  assert.match(skill, /cross-run duplicate suppression.*host semantic judgment.*complete prior-feedback ledger/is);
  assert.match(skill, /submit.*report.*diff.*gate.*recheck.*head.*write boundary/is);
  assert.match(skill, /Do not add tests, edit production code, apply fixes, commit, or push/i);
  assert.match(report, /careful shake/);
  assert.match(report, /here's what held and what came loose/);
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
  assert.match(validation, /clean.*only.*none.*never.*actionable/is);
  assert.match(
    report,
    /github-review\.mjs prepare.*--report-file.*--diff-file.*--gates-file.*--body-output.*--comments-output/is,
  );
  assert.match(
    report,
    /github-review\.mjs submit.*--report-file.*--diff-file.*--gates-file.*--body-file.*--comments-file/is,
  );
  assert.doesNotMatch(report, /PREPARED_EVENT|prepared event artifact|--event-output/i);
  assert.match(report, /review-linkage fingerprint.*same GitHub review/is);
  assert.match(report, /cross-run duplicate suppression.*host semantic judgment.*complete ledger/is);
  assert.match(report, /submit.*recomputes.*REPORT.*DIFF.*GATES.*head.*immediately before.*POST/is);
  assert.match(report, /prepare.*deterministic.*does not.*GitHub/is);
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
