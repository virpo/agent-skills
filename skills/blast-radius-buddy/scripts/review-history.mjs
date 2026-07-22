#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CURRENT_MARKER = '<!-- blast-radius-buddy -->';
const LEGACY_MARKER = '<!-- review-tube-man -->';
const METADATA_PREFIX = '<!-- blast-radius-buddy-review:';
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SUMMARY_LIMIT = 160;
const PACKET_LINE_LIMIT = 480;

const REVIEW_THREADS_QUERY = `
query ReviewThreads($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        nodes {
          id
          isResolved
          isOutdated
          resolvedBy { login }
          comments(first: 100) {
            nodes {
              id
              body
              url
              path
              line
              originalLine
              author { login }
              pullRequestReview { state }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const ROOT_REVIEWS_QUERY = `
query RootReviews($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(first: 100, after: $cursor) {
        nodes {
          id
          body
          url
          state
          submittedAt
          author { login }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const defaultExecute = (command, args) => execFileAsync(command, args, {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

function positiveSafeInteger(value) {
  if (!/^\d+$/.test(String(value))) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function validateInputs({ repo, number, headSha, prAuthor, execute }) {
  if (!REPO_PATTERN.test(repo)) {
    throw new TypeError('repo must use OWNER/REPO format');
  }
  if (positiveSafeInteger(number) === undefined) {
    throw new TypeError('pr must be a positive safe integer');
  }
  if (!/^[0-9a-f]{7,64}$/i.test(headSha)) {
    throw new TypeError('head-sha must be a 7-64 character hexadecimal commit id');
  }
  if (typeof prAuthor !== 'string' || prAuthor.length === 0) {
    throw new TypeError('author must be a non-empty login');
  }
  if (typeof execute !== 'function') {
    throw new TypeError('execute must be a function');
  }
}

function parseJson(result, label) {
  const stdout = typeof result === 'string' ? result : result?.stdout;
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Invalid JSON from ${label}: ${error.message}`);
  }
}

function normalizeString(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedText(value, fallback = '') {
  return normalizeString(value) || fallback;
}

function displayField(value, fallback = '') {
  const normalized = normalizedText(value, fallback);
  if (normalized.length <= SUMMARY_LIMIT) return normalized;
  return `${normalized.slice(0, SUMMARY_LIMIT - 3).trimEnd()}...`;
}

function buddyFindingId(value) {
  const normalized = normalizeString(value);
  return /^BRB[0-9]{3,6}$/.test(normalized) ? normalized : '';
}

function normalizedUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  try {
    const { protocol } = new URL(normalized);
    return protocol === 'http:' || protocol === 'https:' ? normalized : null;
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))];
}

function graphQlArgs(query, repo, number, cursor) {
  const [owner, name] = repo.split('/');
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '-F',
    `number=${number}`,
  ];
  if (cursor !== null) args.push('-f', `cursor=${cursor}`);
  return args;
}

async function loadConnection({ repo, number, execute, query, connectionName }) {
  const nodes = [];
  let cursor = null;

  do {
    const raw = parseJson(
      await execute('gh', graphQlArgs(query, repo, number, cursor)),
      connectionName,
    );
    const connection = raw?.data?.repository?.pullRequest?.[connectionName];
    if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo) {
      throw new Error(`GitHub ${connectionName} response is incomplete`);
    }
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) break;
    if (typeof connection.pageInfo.endCursor !== 'string' || connection.pageInfo.endCursor.length === 0) {
      throw new Error(`GitHub ${connectionName} pagination cursor is missing`);
    }
    cursor = connection.pageInfo.endCursor;
  } while (true);

  return nodes;
}

export function classifyThread(thread, prAuthor) {
  if (thread.isOutdated) return 'outdated';
  if (!thread.isResolved) return 'open';
  if (thread.resolvedBy?.login === prAuthor) return 'author-resolved';
  return 'resolved';
}

function inlineFindingKey(body) {
  if (typeof body !== 'string') return '';
  const match = body.match(/<!--\s*blast-radius-buddy-finding:([\s\S]*?)-->/);
  return buddyFindingId(match?.[1]);
}

function removeInlineFindingMarker(body) {
  return typeof body === 'string'
    ? body.replace(/<!--\s*blast-radius-buddy-finding:[\s\S]*?-->/g, '')
    : body;
}

function normalizeThread(thread, prAuthor) {
  const root = Array.isArray(thread?.comments?.nodes) ? thread.comments.nodes[0] : undefined;
  const id = normalizedText(thread?.id ?? root?.id, 'unknown-thread');
  const canonicalKey = inlineFindingKey(root?.body) || id;
  return {
    id,
    status: classifyThread(thread ?? {}, prAuthor),
    path: normalizeString(root?.path) || null,
    line: root?.line ?? root?.originalLine ?? null,
    summary: normalizedText(removeInlineFindingMarker(root?.body), 'Review thread'),
    url: normalizedUrl(root?.url),
    source: 'review-thread',
    canonicalKey,
  };
}

export async function loadReviewThreads({
  repo,
  number,
  headSha,
  prAuthor,
  execute = defaultExecute,
}) {
  validateInputs({ repo, number, headSha, prAuthor, execute });
  const threads = await loadConnection({
    repo,
    number: positiveSafeInteger(number),
    execute,
    query: REVIEW_THREADS_QUERY,
    connectionName: 'reviewThreads',
  });
  return threads.map((thread) => normalizeThread(thread, prAuthor));
}

function parseBuddyMetadata(body) {
  if (typeof body !== 'string') return [];
  const records = [];
  let start = body.indexOf(METADATA_PREFIX);

  while (start !== -1) {
    const jsonStart = start + METADATA_PREFIX.length;
    const end = body.indexOf('-->', jsonStart);
    if (end === -1) break;
    try {
      const record = JSON.parse(body.slice(jsonStart, end).trim());
      if (record && typeof record === 'object') records.push(record);
    } catch {
      // Malformed historical metadata is ignored; the surrounding review remains readable.
    }
    start = body.indexOf(METADATA_PREFIX, end + 3);
  }

  return records;
}

function metadataEntries(record, review, source = 'root-review', forcedStatus = null) {
  if (!Array.isArray(record?.findings)) return [];
  return record.findings
    .filter((finding) => finding && typeof finding === 'object')
    .map((finding) => {
      const stableId = buddyFindingId(finding.id);
      if (!stableId) return null;
      const suppliedCanonicalKey = buddyFindingId(finding.canonicalKey);
      const canonicalKey = suppliedCanonicalKey || stableId;
      return {
        id: stableId || canonicalKey,
        status: forcedStatus ?? (finding.status === 'suppressed' ? 'suppressed' : 'reported'),
        path: normalizeString(finding.path) || null,
        line: Number.isSafeInteger(finding.line) && finding.line > 0 ? finding.line : null,
        summary: normalizedText(finding.title, 'Prior Buddy finding'),
        url: normalizedUrl(review.url ?? review.html_url),
        source,
        canonicalKey,
      };
    })
    .filter(Boolean);
}

function removeMetadata(body) {
  if (typeof body !== 'string') return '';
  let output = body;
  let start = output.indexOf(METADATA_PREFIX);
  while (start !== -1) {
    const end = output.indexOf('-->', start + METADATA_PREFIX.length);
    if (end === -1) return output.slice(0, start);
    output = `${output.slice(0, start)}${output.slice(end + 3)}`;
    start = output.indexOf(METADATA_PREFIX);
  }
  return output;
}

function normalizeRootReview(review) {
  const records = parseBuddyMetadata(review?.body);
  const forcedStatus = review?.state === 'DISMISSED' ? 'dismissed' : null;
  const findings = records.flatMap(
    (record) => metadataEntries(record, review, 'root-review', forcedStatus),
  );
  if (findings.length > 0) return findings;

  const body = removeMetadata(review?.body);
  if (review?.state !== 'DISMISSED' && normalizeString(body).length === 0) return [];
  return [{
    id: normalizedText(review?.id, 'unknown-review'),
    status: review?.state === 'DISMISSED' ? 'dismissed' : 'reported',
    path: null,
    line: null,
    summary: normalizedText(body, review?.state === 'DISMISSED' ? 'Dismissed review' : 'Root review'),
    url: normalizedUrl(review?.url),
    source: 'root-review',
  }];
}

async function loadRootReviews({ repo, number, execute }) {
  const reviews = await loadConnection({
    repo,
    number,
    execute,
    query: ROOT_REVIEWS_QUERY,
    connectionName: 'reviews',
  });
  return reviews.flatMap(normalizeRootReview);
}

function isMarkerComment(comment) {
  return typeof comment?.body === 'string'
    && (comment.body.includes(CURRENT_MARKER) || comment.body.includes(LEGACY_MARKER));
}

function normalizeMarkerComment(comment) {
  const history = {
    id: normalizedText(`marker:${comment.id}`, 'marker:unknown'),
    status: 'reported',
    path: null,
    line: null,
    summary: comment.body.includes(CURRENT_MARKER)
      ? 'Blast Radius Buddy run history'
      : 'Legacy Review Tube Man run history',
    url: normalizedUrl(comment.html_url ?? comment.url),
    source: 'run-history',
  };
  const findings = parseBuddyMetadata(comment.body)
    .flatMap((record) => metadataEntries(record, comment, 'marker-report'));
  return [...findings, history];
}

async function loadMarkerHistory({ repo, number, execute }) {
  const raw = parseJson(
    await execute('gh', [
      'api',
      `repos/${repo}/issues/${number}/comments`,
      '--paginate',
      '--slurp',
    ]),
    'issue comments',
  );
  const comments = Array.isArray(raw) ? raw.flat() : [];
  return comments.filter(isMarkerComment).flatMap(normalizeMarkerComment);
}

function coalesceReviewEntries(entries) {
  const byKey = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.status !== 'string') continue;
    const canonicalKey = typeof entry.canonicalKey === 'string' && entry.canonicalKey
      ? entry.canonicalKey
      : entry.id;
    const existing = byKey.get(canonicalKey);
    if (!existing) {
      byKey.set(canonicalKey, {
        ...entry,
        id: canonicalKey,
        ...(entry.canonicalKey ? { canonicalKey } : {}),
        statuses: unique(entry.statuses ?? [entry.status]),
        urls: unique(entry.urls ?? [entry.url]),
        sources: unique(entry.sources ?? [entry.source]),
      });
      continue;
    }

    existing.statuses = unique([...existing.statuses, ...(entry.statuses ?? [entry.status])]);
    existing.urls = unique([...existing.urls, ...(entry.urls ?? [entry.url])]);
    existing.sources = unique([...existing.sources, ...(entry.sources ?? [entry.source])]);
    existing.path ??= entry.path ?? null;
    existing.line ??= entry.line ?? null;
    if (!existing.url && entry.url) existing.url = entry.url;
  }

  return [...byKey.values()];
}

export async function loadReviewLedger({
  repo,
  number,
  headSha,
  prAuthor,
  execute = defaultExecute,
}) {
  validateInputs({ repo, number, headSha, prAuthor, execute });
  const normalizedNumber = positiveSafeInteger(number);
  const threads = await loadReviewThreads({
    repo,
    number: normalizedNumber,
    headSha,
    prAuthor,
    execute,
  });
  const reviews = await loadRootReviews({ repo, number: normalizedNumber, execute });
  const markers = await loadMarkerHistory({ repo, number: normalizedNumber, execute });
  return coalesceReviewEntries([...threads, ...reviews, ...markers]);
}

export function applyReviewAssessments(entries, assessments) {
  const byId = new Map(
    (Array.isArray(assessments) ? assessments : [])
      .filter(({ id, present }) => typeof id === 'string' && typeof present === 'boolean')
      .map((assessment) => [assessment.id, assessment]),
  );
  const preserved = new Set([
    'author-resolved',
    'dismissed',
    'suppressed',
    'outdated',
  ]);

  return entries.map((entry) => {
    const assessment = byId.get(entry.id);
    if (!assessment || preserved.has(entry.status)) return { ...entry };

    let status = entry.status;
    if (entry.status === 'open') status = assessment.present ? 'still-open' : 'fixed';
    if (entry.status === 'resolved') {
      status = assessment.present ? 'resolved-but-still-present' : 'fixed';
    }
    if (status === entry.status) return { ...entry };
    return {
      ...entry,
      status,
      ...(Array.isArray(entry.statuses)
        ? { statuses: unique([status, ...entry.statuses]) }
        : {}),
    };
  });
}

function packetLine(entry) {
  const statuses = unique(entry.statuses ?? [entry.status])
    .map(displayField)
    .filter(Boolean)
    .join('/');
  const location = entry.path
    ? `${displayField(entry.path)}${entry.line ? `:${entry.line}` : ''}`
    : 'general';
  const urls = unique(entry.urls ?? [entry.url])
    .map(normalizedUrl)
    .filter(Boolean)
  let line = `- [${statuses}] ${displayField(entry.id)} ${location} — ${displayField(entry.summary)}`
    .slice(0, PACKET_LINE_LIMIT);
  let appendedUrl = false;
  for (const url of urls) {
    const separator = appendedUrl ? ', ' : ' — ';
    if (line.length + separator.length + url.length <= PACKET_LINE_LIMIT) {
      line += `${separator}${url}`;
      appendedUrl = true;
    }
  }
  return line;
}

export function compactReviewLedger(entries) {
  return coalesceReviewEntries(Array.isArray(entries) ? entries : [])
    .map(packetLine)
    .join('\n');
}

function usage() {
  return 'Usage: review-history.mjs read --repo OWNER/REPO --pr NUMBER --head-sha SHA --author LOGIN';
}

function readOptions(args) {
  const options = {};
  const allowed = new Set(['repo', 'pr', 'head-sha', 'author']);
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

export async function main(args, dependencies = {}) {
  const [command, ...rest] = args;
  if (command !== 'read') throw new Error(usage());
  const options = readOptions(rest);
  const repo = requireOption(options, 'repo');
  const number = requireOption(options, 'pr');
  const headSha = requireOption(options, 'head-sha');
  const prAuthor = requireOption(options, 'author');
  const execute = dependencies.execute ?? defaultExecute;
  const writeStdout = dependencies.writeStdout ?? ((value) => process.stdout.write(value));
  validateInputs({ repo, number, headSha, prAuthor, execute });

  const ledger = await loadReviewLedger({ repo, number, headSha, prAuthor, execute });
  writeStdout(`${JSON.stringify(ledger)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
