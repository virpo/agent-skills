#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,37}[A-Za-z0-9])?$/;
const HEAD_PATTERN = /^[0-9a-f]{40}$/i;
const HEAD_TRIGGER_PATTERN = /^head:([0-9a-f]{40})$/i;
const REQUEST_TRIGGER_PATTERN = /^review-requested:([1-9]\d*)$/;
const METADATA_PATTERN = /<!-- blast-radius-buddy-review:(\{[^\n]*\}) -->/g;

async function defaultExecute(command, args) {
  return execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

function stdoutOf(result) {
  return typeof result === 'string' ? result : result?.stdout;
}

function parseJsonResult(result, label) {
  const stdout = stdoutOf(result);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Invalid JSON from ${label}: ${error.message}`);
  }
}

function flattenPages(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.flatMap((page) => Array.isArray(page) ? page : [page]);
}

function validTriggerId(value) {
  if (typeof value !== 'string') return false;
  const headMatch = value.match(HEAD_TRIGGER_PATTERN);
  if (headMatch) return true;
  const requestMatch = value.match(REQUEST_TRIGGER_PATTERN);
  if (!requestMatch) return false;
  const id = Number(requestMatch[1]);
  return Number.isSafeInteger(id) && id > 0;
}

export function parseCompletionMetadata(body) {
  if (typeof body !== 'string') return null;
  let match;
  let last;
  while ((match = METADATA_PATTERN.exec(body)) !== null) last = match[1];
  METADATA_PATTERN.lastIndex = 0;
  if (last === undefined) return null;

  try {
    const value = JSON.parse(last);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    if (typeof value.headSha !== 'string' || !HEAD_PATTERN.test(value.headSha)) return null;
    if (value.triggerId !== undefined && !validTriggerId(value.triggerId)) return null;
    return {
      headSha: value.headSha,
      triggerId: value.triggerId ?? null,
    };
  } catch {
    return null;
  }
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function activeCompletions(reviews, headSha) {
  if (!Array.isArray(reviews)) throw new TypeError('reviews must be an array');
  return reviews.flatMap((review) => {
    if (String(review?.state ?? '').toUpperCase() === 'DISMISSED') return [];
    const metadata = parseCompletionMetadata(review?.body);
    if (metadata?.headSha !== headSha) return [];
    const submittedAt = timestamp(review?.submitted_at ?? review?.submittedAt);
    if (submittedAt === null) return [];
    return [{ metadata, submittedAt }];
  });
}

function matchingRequests(timeline, reviewer) {
  if (!Array.isArray(timeline)) throw new TypeError('timeline must be an array');
  return timeline.flatMap((event) => {
    if (event?.event !== 'review_requested'
      || event?.requested_reviewer?.login !== reviewer
      || !Number.isSafeInteger(event?.id)
      || event.id <= 0) {
      return [];
    }
    const createdAt = timestamp(event.created_at);
    if (createdAt === null) return [];
    return [{ id: event.id, createdAt }];
  });
}

export function selectTrigger({ headSha, reviews, timeline, reviewer }) {
  if (typeof headSha !== 'string' || !HEAD_PATTERN.test(headSha)) {
    throw new TypeError('headSha must be a full hexadecimal commit id');
  }
  if (typeof reviewer !== 'string' || !LOGIN_PATTERN.test(reviewer)) {
    throw new TypeError('reviewer must be a GitHub login');
  }

  const completions = activeCompletions(reviews, headSha);
  if (completions.length === 0) {
    return { triggerId: `head:${headSha}`, triggerKind: 'head' };
  }

  const latestCompletion = Math.max(...completions.map(({ submittedAt }) => submittedAt));
  const completedTriggerIds = new Set(
    completions.map(({ metadata }) => metadata.triggerId).filter(Boolean),
  );
  const request = matchingRequests(timeline, reviewer)
    .filter(({ id, createdAt }) => (
      createdAt > latestCompletion && !completedTriggerIds.has(`review-requested:${id}`)
    ))
    .toSorted((left, right) => right.createdAt - left.createdAt || right.id - left.id)[0];

  return request
    ? { triggerId: `review-requested:${request.id}`, triggerKind: 'review-requested' }
    : null;
}

function validateInputs({ repo, author, reviewer, execute }) {
  if (typeof repo !== 'string' || !REPO_PATTERN.test(repo)) {
    throw new TypeError('repo must use OWNER/REPO format');
  }
  if (typeof author !== 'string' || !LOGIN_PATTERN.test(author)) {
    throw new TypeError('author must be a GitHub login');
  }
  if (typeof reviewer !== 'string' || !LOGIN_PATTERN.test(reviewer)) {
    throw new TypeError('reviewer must be a GitHub login');
  }
  if (typeof execute !== 'function') throw new TypeError('execute must be a function');
}

async function requiredChecks({ repo, number, execute }) {
  const args = [
    'pr', 'checks', String(number), '--repo', repo, '--required',
    '--json', 'name,bucket,state',
  ];
  try {
    return parseJsonResult(await execute('gh', args), `required checks for PR #${number}`);
  } catch (error) {
    if (typeof error?.stderr === 'string'
      && /no required checks reported/i.test(error.stderr)) {
      return [];
    }
    if (error && typeof error === 'object' && typeof error.stdout === 'string') {
      try {
        return JSON.parse(error.stdout);
      } catch {
        // Preserve the original GitHub failure when stdout is not usable JSON.
      }
    }
    throw error;
  }
}

function validatePullRequest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('pull request must be an object');
  }
  if (!Number.isSafeInteger(value.number) || value.number <= 0) {
    throw new TypeError('pull request number must be a positive safe integer');
  }
  if (typeof value.url !== 'string' || !/^https:\/\/github\.com\//.test(value.url)) {
    throw new TypeError('pull request URL must be a GitHub URL');
  }
  if (typeof value.isDraft !== 'boolean') throw new TypeError('pull request isDraft must be boolean');
  if (typeof value.headRefOid !== 'string' || !HEAD_PATTERN.test(value.headRefOid)) {
    throw new TypeError('pull request headRefOid must be a full hexadecimal commit id');
  }
  if (typeof value.author?.login !== 'string') {
    throw new TypeError('pull request author login is required');
  }
  return value;
}

export async function findEligibleTriggers({
  repo,
  author,
  reviewer,
  execute = defaultExecute,
}) {
  validateInputs({ repo, author, reviewer, execute });
  const listed = parseJsonResult(await execute('gh', [
    'pr', 'list', '--repo', repo, '--state', 'open', '--author', author,
    '--limit', '100', '--json', 'number,url,isDraft,headRefOid,author',
  ]), 'open pull requests');
  if (!Array.isArray(listed)) throw new TypeError('open pull requests must be an array');

  const triggers = [];
  for (const raw of listed) {
    const pullRequest = validatePullRequest(raw);
    if (pullRequest.isDraft || pullRequest.author.login !== author) continue;

    const checks = await requiredChecks({ repo, number: pullRequest.number, execute });
    if (!Array.isArray(checks)) throw new TypeError('required checks must be an array');
    if (checks.some((check) => check?.bucket !== 'pass')) continue;

    const reviews = flattenPages(parseJsonResult(await execute('gh', [
      'api', `repos/${repo}/pulls/${pullRequest.number}/reviews`, '--paginate', '--slurp',
    ]), `reviews for PR #${pullRequest.number}`), 'reviews');
    const timeline = flattenPages(parseJsonResult(await execute('gh', [
      'api', `repos/${repo}/issues/${pullRequest.number}/timeline`, '--paginate', '--slurp',
      '-H', 'Accept: application/vnd.github+json',
    ]), `timeline for PR #${pullRequest.number}`), 'timeline');
    const trigger = selectTrigger({
      headSha: pullRequest.headRefOid,
      reviews,
      timeline,
      reviewer,
    });
    if (trigger) {
      triggers.push({
        repo,
        number: pullRequest.number,
        url: pullRequest.url,
        headSha: pullRequest.headRefOid,
        ...trigger,
      });
    }
  }

  return triggers.toSorted((left, right) => left.number - right.number);
}

function usage() {
  return 'Usage: github-watch.mjs --repo OWNER/REPO --author LOGIN --reviewer LOGIN';
}

function readOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || value === undefined || options[flag.slice(2)] !== undefined) {
      throw new Error(usage());
    }
    options[flag.slice(2)] = value;
  }
  return options;
}

export async function main(args, dependencies = {}) {
  const options = readOptions(args);
  const triggers = await findEligibleTriggers({
    repo: options.repo,
    author: options.author,
    reviewer: options.reviewer,
    execute: dependencies.execute ?? defaultExecute,
  });
  const write = dependencies.write ?? ((text) => process.stdout.write(text));
  for (const trigger of triggers) write(`${JSON.stringify(trigger)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
