import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

test('reviewers receive an untrusted packet through a tool-less or externally isolated process', async () => {
  const [skill, prompts, scenario] = await Promise.all([
    read('skills/blast-radius-buddy/SKILL.md'),
    read('skills/blast-radius-buddy/references/reviewer-prompts.md'),
    read('tests/scenarios/blast-radius-buddy.md'),
  ]);

  assert.match(skill, /repository content as untrusted data/i);
  assert.match(skill, /newly created neutral director/i);
  assert.match(prompts, /never run a reviewer from the target repository/i);
  assert.match(prompts, /contains no checked-out PR files or repository configuration/i);
  assert.match(prompts, /packet must contain everything the reviewer needs/i);
  assert.match(prompts, /no repository access or tools/i);
  assert.match(
    prompts,
    /claude --safe-mode --tools "" --disable-slash-commands --no-session-persistence --permission-mode plan/,
  );
  assert.match(prompts, /preferred Codex path is a fresh OpenAI API or model invocation/i);
  assert.match(prompts, /tools omitted or disabled/i);
  assert.match(prompts, /only the untrusted bounded packet as input/i);
  assert.match(prompts, /Codex CLI is allowed only inside an external sandbox or container/i);
  assert.match(prompts, /exposes only the neutral packet directory/i);
  assert.match(prompts, /not the target repository or host filesystem/i);
  assert.match(prompts, /does not expose secrets to model tools/i);
  assert.match(prompts, /own read-only sandbox does not supply this boundary/i);
  assert.match(prompts, /choose another different coding agent or stop as blocked/i);
  assert.doesNotMatch(prompts, /^codex exec .*--sandbox read-only/m);
  assert.doesNotMatch(prompts, /-C "\$REPOSITORY"/);
  assert.match(scenario, /fresh neutral director/i);
  assert.match(scenario, /customizations are disabled/i);
  assert.match(scenario, /fresh OpenAI API or model invocation/i);
  assert.match(scenario, /external sandbox or container/i);
  assert.match(scenario, /target repository or host filesystem/i);
  assert.match(scenario, /stop as blocked/i);
});

test('authorized repairs require a durable automated regression test even after reproducible-check triage', async () => {
  const [skill, angles, prompts, report, scenario] = await Promise.all([
    read('skills/blast-radius-buddy/SKILL.md'),
    read('skills/blast-radius-buddy/references/review-angles.md'),
    read('skills/blast-radius-buddy/references/reviewer-prompts.md'),
    read('skills/blast-radius-buddy/references/github-report.md'),
    read('tests/scenarios/blast-radius-buddy.md'),
  ]);

  assert.match(skill, /durable automated regression test/i);
  assert.match(skill, /before changing production code/i);
  assert.match(angles, /reproducible check may survive triage/i);
  assert.match(angles, /never substitutes for a durable automated regression test/i);
  assert.match(prompts, /durable regression test path and name/i);
  assert.match(prompts, /RED.*GREEN/s);
  assert.match(report, /Repair regression:/);
  assert.match(scenario, /durable automated regression test/i);
  assert.match(scenario, /reproducible check/i);
});
