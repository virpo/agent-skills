#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const defaultExecute = (command, args) => execFileAsync(command, args, {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

const PR_FIELDS = [
  'number', 'url', 'title', 'body', 'baseRefOid', 'headRefOid',
  'author', 'files', 'statusCheckRollup', 'headRepositoryOwner',
].join(',');
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function positiveSafeInteger(value) {
  if (!/^\d+$/.test(String(value))) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function parseTarget(target) {
  if (target === undefined) return {};
  const number = positiveSafeInteger(target);
  if (number !== undefined) return { number };

  const match = String(target).match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/,
  );
  const urlNumber = match ? positiveSafeInteger(match[3]) : undefined;
  if (!match || urlNumber === undefined) {
    throw new TypeError('target must be a GitHub PR URL, positive PR number, or omitted');
  }

  return {
    repo: `${match[1]}/${match[2]}`,
    number: urlNumber,
    url: String(target),
  };
}

function parseJson(result, label) {
  const stdout = typeof result === 'string' ? result : result?.stdout;

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Invalid JSON from ${label}: ${error.message}`);
  }
}

async function currentRepo(execute) {
  const raw = parseJson(
    await execute('gh', ['repo', 'view', '--json', 'nameWithOwner']),
    'repository',
  );
  if (!REPO_PATTERN.test(raw.nameWithOwner)) {
    throw new Error('GitHub repository could not be resolved');
  }
  return raw.nameWithOwner;
}

function normalizeCheck(check) {
  const value = String(
    check.conclusion ?? check.state ?? check.status ?? '',
  ).toUpperCase();
  const state = ['SUCCESS'].includes(value) ? 'pass'
    : ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(value)
      ? 'fail'
      : ['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED'].includes(value)
        ? 'pending'
        : 'neutral';

  return {
    name: check.name ?? check.context ?? 'unknown',
    state,
    required: check.isRequired === true,
  };
}

function normalizePullRequest(repo, raw) {
  if (!Number.isInteger(raw.number) || !raw.headRefOid || !raw.baseRefOid) {
    throw new Error('Pull request metadata is incomplete');
  }

  return {
    repo,
    number: raw.number,
    url: raw.url,
    title: raw.title,
    body: raw.body ?? '',
    authorLogin: raw.author?.login ?? null,
    baseSha: raw.baseRefOid,
    headSha: raw.headRefOid,
    files: Array.isArray(raw.files) ? raw.files : [],
    checks: Array.isArray(raw.statusCheckRollup)
      ? raw.statusCheckRollup.map(normalizeCheck)
      : [],
  };
}

export async function resolvePullRequest({ target, execute = defaultExecute }) {
  const parsed = parseTarget(target);
  const repo = parsed.repo ?? await currentRepo(execute);
  const locator = parsed.url ?? parsed.number;
  const args = ['pr', 'view'];
  if (locator !== undefined) args.push(String(locator));
  args.push('--repo', repo, '--json', PR_FIELDS);

  const raw = parseJson(await execute('gh', args), 'pull request');
  return normalizePullRequest(repo, raw);
}

export class StaleHeadError extends Error {
  constructor(expectedHeadSha, actualHeadSha) {
    super(`Pull request head changed from ${expectedHeadSha} to ${actualHeadSha}`);
    this.name = 'StaleHeadError';
    this.expectedHeadSha = expectedHeadSha;
    this.actualHeadSha = actualHeadSha;
  }
}

export async function assertHeadUnchanged({
  repo,
  number,
  expectedHeadSha,
  execute = defaultExecute,
}) {
  const raw = parseJson(
    await execute('gh', [
      'pr', 'view', String(number), '--repo', repo, '--json', 'headRefOid',
    ]),
    'pull request head',
  );
  const actualHeadSha = raw.headRefOid;
  if (typeof actualHeadSha !== 'string' || actualHeadSha.length === 0) {
    throw new Error('Pull request head metadata is incomplete');
  }
  if (actualHeadSha !== expectedHeadSha) {
    throw new StaleHeadError(expectedHeadSha, actualHeadSha);
  }
  return actualHeadSha;
}

function usage() {
  return [
    'Usage:',
    '  github-pr.mjs resolve [--target URL_OR_NUMBER]',
    '  github-pr.mjs check-head --repo OWNER/REPO --pr NUMBER --expected-sha SHA',
  ].join('\n');
}

function readOptions(args, allowed) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    const name = flag?.startsWith('--') ? flag.slice(2) : undefined;
    if (!name || !allowed.has(name) || value === undefined || options[name] !== undefined) {
      throw new Error(usage());
    }
    options[name] = value;
  }
  return options;
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function validateRepo(value) {
  if (!REPO_PATTERN.test(value)) {
    throw new TypeError('repo must use OWNER/REPO format');
  }
  return value;
}

function validatePr(value) {
  const number = positiveSafeInteger(value);
  if (number === undefined) {
    throw new TypeError('pr must be a positive safe integer');
  }
  return number;
}

function validateExpectedSha(value) {
  if (!/^[0-9a-f]{7,64}$/i.test(value)) {
    throw new TypeError('expected-sha must be a 7-64 character hexadecimal commit id');
  }
  return value;
}

export async function main(args, dependencies = {}) {
  const [command, ...rest] = args;
  const execute = dependencies.execute ?? defaultExecute;
  const writeStdout = dependencies.writeStdout ?? ((value) => process.stdout.write(value));
  let result;

  if (command === 'resolve') {
    const options = readOptions(rest, new Set(['target']));
    result = await resolvePullRequest({ target: options.target, execute });
  } else if (command === 'check-head') {
    const options = readOptions(rest, new Set(['repo', 'pr', 'expected-sha']));
    result = await assertHeadUnchanged({
      repo: validateRepo(requireOption(options, 'repo')),
      number: validatePr(requireOption(options, 'pr')),
      expectedHeadSha: validateExpectedSha(requireOption(options, 'expected-sha')),
      execute,
    });
  } else {
    throw new Error(usage());
  }

  writeStdout(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
