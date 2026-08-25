import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  withReviewWorkspace,
} from '../skills/blast-radius-buddy/scripts/review-workspace.mjs';

const execFileAsync = promisify(execFile);

async function fixtureRepository() {
  const root = await mkdtemp(join(tmpdir(), 'brb-workspace-fixture-'));
  const repository = join(root, 'repository');
  await mkdir(join(repository, 'src'), { recursive: true });
  await mkdir(join(repository, 'tests'), { recursive: true });
  await writeFile(join(repository, 'AGENTS.md'), 'root rules\n');
  await writeFile(join(repository, 'src', 'AGENTS.md'), 'source rules\n');
  await writeFile(join(repository, 'src', 'jobs.ts'), 'export const jobs = 1;\n');
  await writeFile(join(repository, 'tests', 'jobs.test.ts'), 'test();\n');
  await execFileAsync('git', ['init', repository]);
  await execFileAsync('git', ['-C', repository, 'config', 'user.email', 'test@example.com']);
  await execFileAsync('git', ['-C', repository, 'config', 'user.name', 'Test']);
  await execFileAsync('git', ['-C', repository, 'add', '.']);
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'fixture']);
  const { stdout } = await execFileAsync('git', ['-C', repository, 'rev-parse', 'HEAD']);
  return { root, repository, headSha: stdout.trim() };
}

function context(headSha) {
  return {
    repo: 'acme/widgets',
    number: 42,
    title: 'Persist retry state',
    body: 'Keeps failed jobs eligible.',
    authorLogin: 'author',
    baseSha: 'f'.repeat(40),
    headSha,
    triggerId: `head:${headSha}`,
    files: [{ path: 'src/jobs.ts' }, { path: 'tests/jobs.test.ts' }],
    diff: 'diff --git a/src/jobs.ts b/src/jobs.ts\n',
    changedLines: { 'src/jobs.ts': [1] },
    priorLedger: '(no prior feedback)',
  };
}

test('withReviewWorkspace materializes exact-head artifacts and nested agent rules', async () => {
  const fixture = await fixtureRepository();
  let workspaceRoot;
  try {
    const result = await withReviewWorkspace({
      repository: fixture.repository,
      context: context(fixture.headSha),
      inspect: async (workspace) => {
        workspaceRoot = workspace.root;
        const { stdout } = await execFileAsync('git', [
          '-C', workspace.checkout, 'rev-parse', 'HEAD',
        ]);
        assert.equal(stdout.trim(), fixture.headSha);
        const metadata = JSON.parse(await readFile(workspace.artifacts.pr, 'utf8'));
        const rules = JSON.parse(await readFile(workspace.artifacts.agentRules, 'utf8'));
        assert.equal(metadata.headSha, fixture.headSha);
        assert.deepEqual(rules.map(({ path, appliesTo }) => ({ path, appliesTo })), [
          { path: 'AGENTS.md', appliesTo: ['src/jobs.ts', 'tests/jobs.test.ts'] },
          { path: 'src/AGENTS.md', appliesTo: ['src/jobs.ts'] },
        ]);
        assert.equal(await readFile(workspace.artifacts.diff, 'utf8'), context(fixture.headSha).diff);
        return 'inspected';
      },
    });
    assert.equal(result, 'inspected');
    await assert.rejects(access(workspaceRoot), (error) => error.code === 'ENOENT');
    const { stdout: worktrees } = await execFileAsync('git', [
      '-C', fixture.repository, 'worktree', 'list', '--porcelain',
    ]);
    assert.doesNotMatch(worktrees, /blast-radius-buddy-workspace-/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('withReviewWorkspace rejects a dirty checkout and removes it', async () => {
  const fixture = await fixtureRepository();
  let workspaceRoot;
  try {
    await assert.rejects(withReviewWorkspace({
      repository: fixture.repository,
      context: context(fixture.headSha),
      inspect: async (workspace) => {
        workspaceRoot = workspace.root;
        await writeFile(join(workspace.checkout, 'src', 'jobs.ts'), 'dirty\n');
      },
    }), /review workspace was modified/i);
    await assert.rejects(access(workspaceRoot), (error) => error.code === 'ENOENT');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('withReviewWorkspace validates paths and identity before invoking git', async () => {
  let calls = 0;
  await assert.rejects(withReviewWorkspace({
    repository: 'relative/repository',
    context: context('0'.repeat(40)),
    execute: async () => { calls += 1; },
    inspect: async () => {},
  }), /repository.*absolute/i);
  await assert.rejects(withReviewWorkspace({
    repository: '/absolute/repository',
    context: { ...context('0'.repeat(40)), files: [{ path: '../secret' }] },
    execute: async () => { calls += 1; },
    inspect: async () => {},
  }), /repository-relative/i);
  assert.equal(calls, 0);
});

test('withReviewWorkspace preserves diagnostics when a reviewer child cannot terminate', async () => {
  const fixture = await fixtureRepository();
  let workspaceRoot;
  try {
    const error = new Error('child still owns the checkout');
    error.name = 'UnterminatedReviewerChildError';
    await assert.rejects(withReviewWorkspace({
      repository: fixture.repository,
      context: context(fixture.headSha),
      inspect: async (workspace) => {
        workspaceRoot = workspace.root;
        throw error;
      },
    }), error);
    await access(workspaceRoot);
  } finally {
    if (workspaceRoot) {
      await execFileAsync('git', [
        '-C', fixture.repository, 'worktree', 'remove', '--force', join(workspaceRoot, 'checkout'),
      ]).catch(() => {});
      await rm(workspaceRoot, { recursive: true, force: true });
    }
    await rm(fixture.root, { recursive: true, force: true });
  }
});
