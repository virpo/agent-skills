#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { writeFile as defaultWriteFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const MARKER = '<!-- blast-radius-buddy -->';
const LEGACY_MARKER = '<!-- review-tube-man -->';
const TITLE = '### 🧨 Blast Radius Buddy';
const STAGES = [
  ['review', 'Three-angle review'],
  ['validation', 'Finding validation'],
  ['verification', 'Fresh-eyes verification'],
];

export function findMarkerComment(comments) {
  const current = comments.find(
    (comment) => typeof comment?.body === 'string' && comment.body.includes(MARKER),
  );

  return current ?? comments.find(
    (comment) => typeof comment?.body === 'string' && comment.body.includes(LEGACY_MARKER),
  );
}

function shortSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{7,64}$/i.test(value)) {
    throw new TypeError('headSha must be a hexadecimal commit id');
  }
  return value.slice(0, 7);
}

export function buildProgressBody({ headSha, completedStages = [] }) {
  shortSha(headSha);
  if (!Array.isArray(completedStages)) {
    throw new TypeError('completedStages must be an array');
  }
  return [
    TITLE,
    '',
    'Checking this PR now. Be right back.',
    '',
    MARKER,
  ].join('\n');
}

export function buildFailureBody({ headSha, reason }) {
  shortSha(headSha);
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new TypeError('reason must be a non-empty string');
  }
  const conclusion = reason.trim().match(/[.!?]$/) ? reason.trim() : `${reason.trim()}.`;
  return [TITLE, '', `Review stopped: ${conclusion}`, '', MARKER].join('\n');
}

export function buildStaleBody({ oldSha, newSha }) {
  shortSha(oldSha);
  shortSha(newSha);
  return [
    TITLE,
    '',
    'The PR changed while I was reviewing it. Run me again on the latest version.',
    '',
    MARKER,
  ].join('\n');
}

export function buildCompletionBody({ headSha, reviewUrl }) {
  shortSha(headSha);
  if (typeof reviewUrl !== 'string' || reviewUrl.trim().length === 0) {
    throw new TypeError('reviewUrl must be a non-empty string');
  }
  return [
    TITLE,
    '',
    `Review complete: [see the result](${reviewUrl.trim()}).`,
    '',
    MARKER,
  ].join('\n');
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
  return [
    'Usage:',
    '  review-comment.mjs render --state progress --head-sha SHA --completed review,validation --output FILE',
    '  review-comment.mjs render --state failure --head-sha SHA --reason TEXT --output FILE',
    '  review-comment.mjs render --state stale --old-sha SHA --new-sha SHA --output FILE',
    '  review-comment.mjs render --state completion --head-sha SHA --review-url URL --output FILE',
    '  review-comment.mjs write --repo OWNER/REPO --pr NUMBER --body-file FILE',
  ].join('\n');
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

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function renderBody(options) {
  const state = requireOption(options, 'state');

  if (state === 'progress') {
    const completedStages = options.completed ? options.completed.split(',') : [];
    const knownStages = new Set(STAGES.map(([key]) => key));
    const unknownStage = completedStages.find((stage) => !knownStages.has(stage));
    if (unknownStage) {
      throw new Error(`Unknown completed stage: ${unknownStage}`);
    }
    return buildProgressBody({
      headSha: requireOption(options, 'head-sha'),
      completedStages,
    });
  }

  if (state === 'failure') {
    return buildFailureBody({
      headSha: requireOption(options, 'head-sha'),
      reason: requireOption(options, 'reason'),
    });
  }

  if (state === 'stale') {
    return buildStaleBody({
      oldSha: requireOption(options, 'old-sha'),
      newSha: requireOption(options, 'new-sha'),
    });
  }

  if (state === 'completion') {
    return buildCompletionBody({
      headSha: requireOption(options, 'head-sha'),
      reviewUrl: requireOption(options, 'review-url'),
    });
  }

  throw new Error(`Unknown render state: ${state}`);
}

export async function main(args, dependencies = {}) {
  const [command, ...rest] = args;
  const options = readOptions(rest);

  if (command === 'render') {
    const output = requireOption(options, 'output');
    const body = renderBody(options);
    const writeFile = dependencies.writeFile ?? defaultWriteFile;
    if (typeof writeFile !== 'function') {
      throw new TypeError('writeFile must be a function');
    }
    await writeFile(resolve(output), body, 'utf8');
    return;
  }

  if (command !== 'write') {
    throw new Error(`Refusing GitHub write without explicit "write" command.\n${usage()}`);
  }

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
