import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'sell-my-stuff');

test('review.mjs still runs when installed through a symlink', async () => {
  const installDir = await mkdtemp(join(tmpdir(), 'sell-my-stuff-link-'));
  const linked = join(installDir, 'sell-my-stuff');
  await symlink(skillDir, linked);
  await assert.rejects(run(process.execPath, [join(linked, 'scripts', 'review.mjs')]), err => {
    assert.equal(err.code, 1);
    assert.match(err.stderr, /^Usage: /);
    return true;
  });
});
