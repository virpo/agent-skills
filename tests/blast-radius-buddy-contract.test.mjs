import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

test('documents the native high-signal PR review contract', async () => {
  const [skill, report, validation, readme] = await Promise.all([
    read('skills/blast-radius-buddy/SKILL.md'),
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
  assert.match(skill, /Do not add tests, edit production code, apply fixes, commit, or push/i);
  assert.match(report, /careful shake/);
  assert.match(report, /here's what held and what came loose/);
  assert.match(validation, /confirmed.*narrowed.*downgraded.*unclear.*refuted/is);
  assert.doesNotMatch(skill, /repair loop/i);
  assert.ok(skill.trim().split(/\s+/).length < 700, 'SKILL.md must stay below 700 words');
  assert.doesNotMatch(readme, /accepted findings[^.\n]*fix/i);
  assert.match(readme, /does not authorize code edits, commits, pushes/i);
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
