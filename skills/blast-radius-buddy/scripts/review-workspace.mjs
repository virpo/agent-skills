import { execFile } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REVIEW_WORKSPACE_PREFIX = join(tmpdir(), 'blast-radius-buddy-workspace-');

const defaultExecute = (command, args) => execFileAsync(command, args, {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

function stdoutOf(result) {
  return typeof result === 'string' ? result : result?.stdout;
}

function repositoryPath(value, label) {
  if (typeof value !== 'string' || value.length === 0
    || value.startsWith('/') || /^[A-Za-z]:\//.test(value)
    || value.includes('\\') || /[\u0000-\u001f\u007f-\u009f]/.test(value)
    || value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new TypeError(`${label} must be a repository-relative path`);
  }
  return value;
}

function contextChangedFiles(context) {
  if (!Array.isArray(context?.files) || context.files.length === 0) {
    throw new TypeError('context.files must be a non-empty array');
  }
  const paths = context.files.map((item, index) => repositoryPath(
    typeof item === 'string' ? item : item?.path,
    `context.files[${index}].path`,
  ));
  if (new Set(paths).size !== paths.length) {
    throw new TypeError('context.files must contain unique paths');
  }
  return paths;
}

function validateOptions({ repository, context, execute, inspect }) {
  if (typeof repository !== 'string' || !isAbsolute(repository)) {
    throw new TypeError('repository must be an absolute path');
  }
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new TypeError('context must be an object');
  }
  if (typeof context.headSha !== 'string' || !/^[0-9a-f]{40}$/i.test(context.headSha)) {
    throw new TypeError('context.headSha must be a full commit SHA');
  }
  if (typeof context.diff !== 'string' || context.diff.length === 0) {
    throw new TypeError('context.diff must be a non-empty string');
  }
  if (typeof execute !== 'function') throw new TypeError('execute must be a function');
  if (typeof inspect !== 'function') throw new TypeError('inspect must be a function');
  return contextChangedFiles(context);
}

function inside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function readRule(checkout, rulePath) {
  const candidate = resolve(checkout, rulePath);
  if (!inside(checkout, candidate)) throw new Error('Agent rule escaped the checkout');
  try {
    const stat = await lstat(candidate);
    if (!stat.isFile() && !stat.isSymbolicLink()) return undefined;
    const actual = await realpath(candidate);
    if (!inside(checkout, actual)) {
      throw new Error(`Agent rule symlink escapes the checkout: ${rulePath}`);
    }
    return await readFile(actual, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function ruleCandidates(changedFiles) {
  const candidates = new Set(['AGENTS.md']);
  for (const file of changedFiles) {
    const directory = dirname(file);
    if (directory === '.') continue;
    const segments = directory.split('/');
    for (let count = 1; count <= segments.length; count += 1) {
      candidates.add(`${segments.slice(0, count).join('/')}/AGENTS.md`);
    }
  }
  return [...candidates].toSorted((left, right) => {
    const depth = left.split('/').length - right.split('/').length;
    return depth || left.localeCompare(right);
  });
}

function appliesTo(rulePath, changedFiles) {
  const directory = dirname(rulePath);
  if (directory === '.') return changedFiles;
  return changedFiles.filter((file) => file.startsWith(`${directory}/`));
}

async function discoverAgentRules(checkout, changedFiles) {
  const rules = [];
  for (const path of ruleCandidates(changedFiles)) {
    const content = await readRule(checkout, path);
    if (content === undefined) continue;
    rules.push({ path, appliesTo: appliesTo(path, changedFiles), content });
  }
  return rules;
}

async function removeWorkspace(directory) {
  if (typeof directory !== 'string' || !directory.startsWith(REVIEW_WORKSPACE_PREFIX)) {
    throw new Error('Refusing to remove an unsafe review workspace');
  }
  await rm(directory, { recursive: true, force: true });
}

function preserveFor(error) {
  return error?.name === 'UnterminatedReviewerChildError'
    || error?.name === 'UnterminatedDiagnosticChildError';
}

async function ensureExactHead(repository, headSha, execute) {
  try {
    await execute('git', ['-C', repository, 'cat-file', '-e', `${headSha}^{commit}`]);
    return;
  } catch {
    await execute('git', [
      '-C', repository, 'fetch', '--no-tags', 'origin', headSha,
    ]);
    await execute('git', ['-C', repository, 'cat-file', '-e', `${headSha}^{commit}`]);
  }
}

export async function withReviewWorkspace({
  repository,
  context,
  execute = defaultExecute,
  inspect,
}) {
  const changedFiles = validateOptions({ repository, context, execute, inspect });
  const root = await mkdtemp(REVIEW_WORKSPACE_PREFIX);
  const checkout = join(root, 'checkout');
  const artifactDirectory = join(root, 'artifacts');
  let added = false;
  let preserve = false;
  try {
    await ensureExactHead(repository, context.headSha, execute);
    await execute('git', [
      '-C', repository, 'worktree', 'add', '--detach', checkout, context.headSha,
    ]);
    added = true;
    const actualHead = stdoutOf(await execute('git', [
      '-C', checkout, 'rev-parse', 'HEAD',
    ]))?.trim();
    if (actualHead !== context.headSha) {
      throw new Error(`Review workspace head mismatch: expected ${context.headSha}, got ${actualHead}`);
    }
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
    const artifacts = {
      pr: join(artifactDirectory, 'pr.json'),
      diff: join(artifactDirectory, 'diff.patch'),
      changedLines: join(artifactDirectory, 'changed-lines.json'),
      priorFeedback: join(artifactDirectory, 'prior-feedback.md'),
      agentRules: join(artifactDirectory, 'agent-rules.json'),
    };
    const metadata = {
      repo: context.repo,
      number: context.number,
      title: context.title,
      body: context.body,
      authorLogin: context.authorLogin,
      baseSha: context.baseSha,
      headSha: context.headSha,
      triggerId: context.triggerId,
      files: context.files,
    };
    const rules = await discoverAgentRules(await realpath(checkout), changedFiles);
    await Promise.all([
      writeFile(artifacts.pr, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 }),
      writeFile(artifacts.diff, context.diff, { mode: 0o600 }),
      writeFile(
        artifacts.changedLines,
        `${JSON.stringify(context.changedLines ?? {}, null, 2)}\n`,
        { mode: 0o600 },
      ),
      writeFile(artifacts.priorFeedback, context.priorLedger || '(no prior feedback)', {
        mode: 0o600,
      }),
      writeFile(artifacts.agentRules, `${JSON.stringify(rules, null, 2)}\n`, { mode: 0o600 }),
    ]);
    const result = await inspect({ root, checkout, artifacts, changedFiles });
    const dirty = stdoutOf(await execute('git', [
      '-C', checkout, 'status', '--porcelain', '--untracked-files=all',
    ]));
    if (typeof dirty !== 'string') throw new Error('Could not inspect review workspace status');
    if (dirty.trim().length > 0) throw new Error('Review workspace was modified');
    return result;
  } catch (error) {
    preserve = preserveFor(error);
    throw error;
  } finally {
    if (!preserve) {
      try {
        if (added) {
          await execute('git', [
            '-C', repository, 'worktree', 'remove', '--force', checkout,
          ]);
        }
      } finally {
        await removeWorkspace(root);
      }
    }
  }
}

export function reviewWorkspaceRelativePath(workspace, absolutePath) {
  const value = relative(workspace.root, absolutePath);
  if (value.startsWith('..') || isAbsolute(value)) {
    throw new Error('Path is outside the review workspace');
  }
  return value;
}
