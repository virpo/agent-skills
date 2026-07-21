#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const MARKER = '<!-- blast-radius-buddy -->';
const LEGACY_MARKER = '<!-- review-tube-man -->';
const START_COPY = 'I am going to review this. I will update this comment with findings.';

export function findMarkerComment(comments) {
  const current = comments.find(
    (comment) => typeof comment?.body === 'string' && comment.body.includes(MARKER),
  );

  return current ?? comments.find(
    (comment) => typeof comment?.body === 'string' && comment.body.includes(LEGACY_MARKER),
  );
}

export function buildStartBody() {
  return `${START_COPY}\n\n${MARKER}`;
}

async function defaultExecute(command, args) {
  return execFileAsync(command, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

function parseJson(result, label) {
  const stdout = typeof result === 'string' ? result : result?.stdout;

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Invalid JSON from ${label}: ${error.message}`);
  }
}

function validateInputs({ repo, pr, bodyFile, execute }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new TypeError('repo must use OWNER/REPO format');
  }

  if (!/^\d+$/.test(String(pr)) || Number(pr) < 1) {
    throw new TypeError('pr must be a positive integer');
  }

  if (typeof bodyFile !== 'string' || bodyFile.length === 0) {
    throw new TypeError('bodyFile must be a non-empty path');
  }

  if (typeof execute !== 'function') {
    throw new TypeError('execute must be a function');
  }
}

export async function upsertReviewComment({
  repo,
  pr,
  bodyFile,
  execute = defaultExecute,
}) {
  validateInputs({ repo, pr, bodyFile, execute });

  const viewer = parseJson(await execute('gh', ['api', 'user']), 'authenticated user');
  if (typeof viewer?.login !== 'string' || viewer.login.length === 0) {
    throw new Error('Authenticated GitHub user has no login');
  }

  const endpoint = `repos/${repo}/issues/${pr}/comments`;
  const pages = parseJson(
    await execute('gh', ['api', endpoint, '--paginate', '--slurp']),
    'issue comments',
  );
  const comments = Array.isArray(pages) ? pages.flat() : [];
  const ownComments = comments.filter((comment) => comment?.user?.login === viewer.login);
  const existing = findMarkerComment(ownComments);
  const writeArgs = existing
    ? [
        'api',
        '--method',
        'PATCH',
        `repos/${repo}/issues/comments/${existing.id}`,
        '--field',
        `body=@${bodyFile}`,
      ]
    : [
        'api',
        '--method',
        'POST',
        endpoint,
        '--field',
        `body=@${bodyFile}`,
      ];

  const written = parseJson(await execute('gh', writeArgs), 'written review comment');
  return {
    action: existing ? 'updated' : 'created',
    commentId: written.id,
  };
}

function usage() {
  return 'Usage: review-comment.mjs write --repo OWNER/REPO --pr NUMBER --body-file FILE';
}

function readOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(usage());
    }
    options[flag.slice(2)] = value;
  }
  return options;
}

async function main(args) {
  const [command, ...rest] = args;
  if (command !== 'write') {
    throw new Error(`Refusing GitHub write without explicit "write" command.\n${usage()}`);
  }

  const options = readOptions(rest);
  const result = await upsertReviewComment({
    repo: options.repo,
    pr: options.pr,
    bodyFile: options['body-file'],
  });
  process.stdout.write(`${result.action} comment ${result.commentId}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
