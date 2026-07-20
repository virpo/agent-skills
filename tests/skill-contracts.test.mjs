import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url).pathname;
const expectedSkills = ['look-hard', 'review-tube-man'];

async function readTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? readTree(path) : readFile(path, 'utf8');
    }),
  );

  return contents.flat().join('\n');
}

test('repository contains exactly the two release skills', async () => {
  const entries = await readdir(join(root, 'skills'), { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(names, expectedSkills);
});

for (const skillName of expectedSkills) {
  test(`${skillName} has valid discovery metadata and public-safe content`, async () => {
    assert.match(skillName, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);

    const skillDir = join(root, 'skills', skillName);
    const skill = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    const metadata = await readFile(join(skillDir, 'agents', 'openai.yaml'), 'utf8');
    const combined = await readTree(skillDir);

    assert.match(skill, new RegExp(`^---\\nname: ${skillName}\\ndescription: Use when`, 'm'));
    assert.doesNotMatch(skill, /^---[\s\S]*?\n(?:metadata|version|license):/m);
    assert.match(metadata, /^interface:\n/m);
    assert.match(metadata, /^  display_name: ".+"$/m);
    assert.match(metadata, /^  short_description: ".{25,64}"$/m);
    assert.match(metadata, new RegExp(`^  default_prompt: ".*\\$${skillName}.*"$`, 'm'));
    assert.doesNotMatch(combined, /\b(?:TODO|TBD)\b/);
    assert.doesNotMatch(combined, /\/Users\//);
    assert.doesNotMatch(combined, /codex:[0-9a-f-]+/i);
    assert.doesNotMatch(combined, /(?:gh[opsu]_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}/);
  });
}
