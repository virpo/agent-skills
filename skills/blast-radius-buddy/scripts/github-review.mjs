#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
  mkdtemp,
  readFile as readFileDefault,
  rm,
  writeFile as writeFileDefault,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const OPENING = "🧨 The shake is over; here's what held and what came loose.";
const EVENTS = new Set(['COMMENT', 'APPROVE']);
const VERDICTS = new Set([
  'Approve',
  'Actionable findings',
  'Review completed with uncertainty',
]);
const ACTIONABLE_SEVERITIES = new Set(['critical', 'high', 'medium']);
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const HEAD_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const FINDING_ID_PATTERN = /^BRB(?:00[1-9]|0[1-9]\d|[1-9]\d{2,5})$/;
const FINDING_MARKER_PATTERN = /<!-- blast-radius-buddy-finding:BRB(?:00[1-9]|0[1-9]\d|[1-9]\d{2,5}) -->$/;

const defaultExecute = (command, args) => execFileAsync(command, args, {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function positiveSafeInteger(value, label) {
  if (!/^\d+$/.test(String(value))) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return number;
}

function fullHeadSha(value) {
  if (typeof value !== 'string' || !HEAD_SHA_PATTERN.test(value)) {
    throw new TypeError('headSha must be the full 40-character hexadecimal commit id');
  }
  return value;
}

function repositoryPath(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a repository-relative path`);
  }
  if (value.startsWith('/') || /^[A-Za-z]:\//.test(value)) {
    throw new TypeError(`${label} must be a repository-relative path`);
  }
  if (value.includes('\\') || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    throw new TypeError(`${label} must be a repository-relative path`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new TypeError(`${label} must be a repository-relative path`);
  }
  return value;
}

function stableFindingId(value, label = 'finding.id') {
  if (typeof value !== 'string' || !FINDING_ID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a stable finding ID`);
  }
  return value;
}

function findingAnchor(finding) {
  if (!Array.isArray(finding?.evidence)) return { path: null, line: null };
  const evidence = finding.evidence.find((item) => plainObject(item)
    && typeof item.path === 'string'
    && Number.isSafeInteger(item.line)
    && item.line > 0);
  return evidence ? { path: evidence.path, line: evidence.line } : { path: null, line: null };
}

function visibleText(value) {
  return value.replace(
    /<!--(?=\s*blast-radius-buddy-(?:review|finding):)/g,
    '&lt;!--',
  );
}

function escapeMetadataJson(value) {
  // JSON accepts Unicode escapes inside strings. This keeps parsed paths and IDs byte-for-byte
  // intact while preventing any report text from terminating the surrounding HTML comment.
  return JSON.stringify(value).replaceAll('--', '-\\u002d');
}

function metadataFor(headSha, findings) {
  return {
    headSha,
    findings: findings.map((finding, index) => {
      const { path, line } = findingAnchor(finding);
      return {
        id: stableFindingId(finding.id, `findings[${index}].id`),
        title: nonEmptyString(finding.title, `findings[${index}].title`),
        path,
        line,
      };
    }),
  };
}

function formatEvidence(evidence) {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .filter((item) => plainObject(item)
      && typeof item.path === 'string'
      && Number.isSafeInteger(item.line)
      && item.line > 0)
    .map((item) => {
      const behavior = typeof item.behavior === 'string' && item.behavior.trim().length > 0
        ? ` — ${visibleText(item.behavior.trim())}`
        : '';
      return `- Evidence: \`${visibleText(item.path)}:${item.line}\`${behavior}`;
    });
}

function formatFinding(finding, index) {
  const id = stableFindingId(finding.id, `findings[${index}].id`);
  const title = visibleText(nonEmptyString(finding.title, `findings[${index}].title`));
  const severity = visibleText(nonEmptyString(finding.severity, `findings[${index}].severity`));
  const confidence = visibleText(nonEmptyString(finding.confidence, `findings[${index}].confidence`));
  const lines = [
    `### ${id} · [${severity} / ${confidence}] ${title}`,
    '',
  ];
  for (const [label, field] of [
    ['Failure', 'what'],
    ['Why', 'why'],
    ['Impact', 'impact'],
  ]) {
    if (typeof finding[field] === 'string' && finding[field].trim().length > 0) {
      lines.push(`- ${label}: ${visibleText(finding[field].trim())}`);
    }
  }
  lines.push(...formatEvidence(finding.evidence));
  if (typeof finding.suggestedFix === 'string' && finding.suggestedFix.trim().length > 0) {
    lines.push(`- Suggested fix: ${visibleText(finding.suggestedFix.trim())}`);
  }
  return lines.join('\n');
}

function formatLedgerEntry(entry) {
  if (typeof entry === 'string') return `- ${visibleText(entry)}`;
  if (!plainObject(entry)) return null;
  const id = typeof entry.id === 'string' && entry.id.length > 0
    ? `${visibleText(entry.id)}: `
    : '';
  const status = typeof entry.status === 'string' && entry.status.length > 0
    ? `[${visibleText(entry.status)}] `
    : '';
  const summary = typeof entry.summary === 'string' && entry.summary.trim().length > 0
    ? visibleText(entry.summary.trim())
    : 'Prior feedback';
  const location = typeof entry.path === 'string' && entry.path.length > 0
    ? ` (\`${visibleText(entry.path)}${Number.isSafeInteger(entry.line) && entry.line > 0 ? `:${entry.line}` : ''}\`)`
    : '';
  return `- ${id}${status}${summary}${location}`;
}

function stringItems(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map(
    (item, index) => visibleText(nonEmptyString(item, `${label}[${index}]`)),
  );
}

export function buildReviewBody(report) {
  if (!plainObject(report)) throw new TypeError('report must be an object');
  if (!VERDICTS.has(report.verdict)) throw new TypeError('report.verdict is unsupported');
  const headSha = fullHeadSha(report.headSha);
  if (!Array.isArray(report.findings)) throw new TypeError('report.findings must be an array');
  const findings = report.findings.filter(
    (finding) => plainObject(finding) && ACTIONABLE_SEVERITIES.has(finding.severity),
  );
  if (!Array.isArray(report.priorFeedback)) {
    throw new TypeError('report.priorFeedback must be an array');
  }
  const validation = stringItems(report.validation, 'report.validation');
  const deferred = stringItems(report.deferred, 'report.deferred');
  if (!plainObject(report.coverage)) throw new TypeError('report.coverage must be an object');
  const coverage = {
    security: visibleText(nonEmptyString(report.coverage.security, 'report.coverage.security')),
    blastRadius: visibleText(
      nonEmptyString(report.coverage.blastRadius, 'report.coverage.blastRadius'),
    ),
    featureTruth: visibleText(
      nonEmptyString(report.coverage.featureTruth, 'report.coverage.featureTruth'),
    ),
  };

  const lines = [
    OPENING,
    '',
    `**Verdict:** ${report.verdict}`,
    `**Reviewed head:** \`${headSha}\``,
  ];

  if (findings.length > 0) {
    lines.push('', '## Actionable findings', '');
    findings.forEach((finding, index) => {
      if (index > 0) lines.push('');
      lines.push(formatFinding(finding, index));
    });
  }

  const priorFeedback = report.priorFeedback.map(formatLedgerEntry).filter(Boolean);
  if (priorFeedback.length > 0) {
    lines.push('', '## Prior feedback', '', ...priorFeedback);
  }
  if (validation.length > 0) {
    lines.push('', '## Validation', '', ...validation.map((item) => `- ${item}`));
  }
  if (deferred.length > 0) {
    lines.push('', '## Deferred', '', ...deferred.map((item) => `- ${item}`));
  }

  lines.push(
    '',
    '## Coverage',
    '',
    `- Security and abuse: ${coverage.security}`,
    `- System blast radius: ${coverage.blastRadius}`,
    `- Feature truth and adjacent regressions: ${coverage.featureTruth}`,
    '',
    `<!-- blast-radius-buddy-review:${escapeMetadataJson(metadataFor(headSha, findings))} -->`,
  );
  return lines.join('\n');
}

function hunkHeader(line) {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/);
  if (!match) return null;
  const values = match.slice(1).map((value, index) => {
    if (value === undefined) return index % 2 === 1 ? 1 : undefined;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
  });
  const [oldStart, oldCount, newStart, newCount] = values;
  if ([oldStart, oldCount, newStart, newCount].some((value) => value === undefined)) {
    return null;
  }
  return { oldCount, newCount, newLine: newStart };
}

function diffPath(line) {
  const match = line.match(/^\+\+\+ b\/(.+)$/);
  if (!match) return null;
  try {
    return repositoryPath(match[1], 'diff path');
  } catch {
    return null;
  }
}

export function collectChangedLines(diff) {
  if (typeof diff !== 'string') throw new TypeError('diff must be a string');
  const changedLines = new Map();
  const lines = diff.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  let currentPath = null;
  let expectsNewPath = false;
  let hunk = null;

  const flushHunk = () => {
    if (hunk
      && hunk.valid
      && hunk.oldSeen === hunk.oldCount
      && hunk.newSeen === hunk.newCount) {
      const existing = changedLines.get(hunk.path) ?? new Set();
      for (const line of hunk.lines) existing.add(line);
      changedLines.set(hunk.path, existing);
    }
    hunk = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushHunk();
      currentPath = null;
      expectsNewPath = false;
      continue;
    }
    if (line.startsWith('@@')) {
      flushHunk();
      const header = currentPath ? hunkHeader(line) : null;
      if (header) {
        hunk = {
          ...header,
          path: currentPath,
          oldSeen: 0,
          newSeen: 0,
          lines: [],
          valid: true,
        };
      }
      continue;
    }
    if (hunk) {
      const prefix = line[0];
      if (prefix === ' ') {
        if (hunk.newLine > 0) hunk.lines.push(hunk.newLine);
        hunk.newLine += 1;
        hunk.oldSeen += 1;
        hunk.newSeen += 1;
      } else if (prefix === '+') {
        if (hunk.newLine > 0) hunk.lines.push(hunk.newLine);
        hunk.newLine += 1;
        hunk.newSeen += 1;
      } else if (prefix === '-') {
        hunk.oldSeen += 1;
      } else if (line !== '\\ No newline at end of file') {
        hunk.valid = false;
      }
      if (hunk.oldSeen > hunk.oldCount || hunk.newSeen > hunk.newCount) {
        hunk.valid = false;
      }
      if (hunk.oldSeen === hunk.oldCount && hunk.newSeen === hunk.newCount) {
        flushHunk();
      }
      continue;
    }
    if (line.startsWith('--- ')) {
      currentPath = null;
      expectsNewPath = true;
      continue;
    }
    if (expectsNewPath) {
      currentPath = diffPath(line);
      expectsNewPath = false;
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      currentPath = null;
    }
  }
  flushHunk();
  return changedLines;
}

function validAnchor(evidence, changedLines) {
  if (!plainObject(evidence)
    || typeof evidence.path !== 'string'
    || !Number.isSafeInteger(evidence.line)
    || evidence.line <= 0) {
    return false;
  }
  return changedLines.get(evidence.path)?.has(evidence.line) === true;
}

function inlineBody(finding, anchor) {
  const id = stableFindingId(finding.id);
  const title = visibleText(nonEmptyString(finding.title, `${id}.title`));
  const severity = typeof finding.severity === 'string'
    ? visibleText(finding.severity)
    : 'finding';
  const confidence = typeof finding.confidence === 'string'
    ? visibleText(finding.confidence)
    : 'unknown confidence';
  const lines = [`**${id} · [${severity} / ${confidence}] ${title}**`];
  for (const field of ['what', 'why', 'impact']) {
    if (typeof finding[field] === 'string' && finding[field].trim().length > 0) {
      lines.push('', visibleText(finding[field].trim()));
    }
  }
  const behavior = typeof anchor.behavior === 'string' && anchor.behavior.trim().length > 0
    ? ` — ${visibleText(anchor.behavior.trim())}`
    : '';
  lines.push('', `Evidence: \`${visibleText(anchor.path)}:${anchor.line}\`${behavior}`);
  if (typeof finding.suggestedFix === 'string' && finding.suggestedFix.trim().length > 0) {
    lines.push('', `Suggested fix: ${visibleText(finding.suggestedFix.trim())}`);
  }

  const sameFile = Array.isArray(finding.evidence)
    && finding.evidence.length > 0
    && finding.evidence.every((item) => plainObject(item) && item.path === anchor.path);
  const suggestedChange = typeof finding.suggestedChange === 'string'
    ? finding.suggestedChange
    : '';
  if (finding.mechanical === true && sameFile && suggestedChange.trim().length > 0) {
    const visibleSuggestion = visibleText(suggestedChange);
    const closingLineBreak = visibleSuggestion.endsWith('\n') ? '' : '\n';
    lines.push('', `\`\`\`suggestion\n${visibleSuggestion}${closingLineBreak}\`\`\``);
  }
  lines.push('', `<!-- blast-radius-buddy-finding:${id} -->`);
  return lines.join('\n');
}

export function partitionInlineFindings(findings, changedLines) {
  if (!Array.isArray(findings)) throw new TypeError('findings must be an array');
  if (!(changedLines instanceof Map)) throw new TypeError('changedLines must be a Map');
  const inline = [];
  const bodyOnly = [];

  findings.forEach((finding, index) => {
    if (!plainObject(finding)) throw new TypeError(`findings[${index}] must be an object`);
    stableFindingId(finding.id, `findings[${index}].id`);
    const anchor = Array.isArray(finding.evidence)
      ? finding.evidence.find((evidence) => validAnchor(evidence, changedLines))
      : undefined;
    if (!anchor) {
      bodyOnly.push(finding);
      return;
    }
    inline.push({
      path: anchor.path,
      line: anchor.line,
      body: inlineBody(finding, anchor),
    });
  });
  return { inline, bodyOnly };
}

function validateComment(comment, index) {
  if (!plainObject(comment)) throw new TypeError(`comments[${index}] must be an object`);
  const path = repositoryPath(comment.path, `comments[${index}].path`);
  const line = positiveSafeInteger(comment.line, `comments[${index}].line`);
  const body = nonEmptyString(comment.body, `comments[${index}].body`);
  if (!FINDING_MARKER_PATTERN.test(body)) {
    throw new TypeError(`comments[${index}].body must end with a stable finding marker`);
  }
  return { path, line, side: 'RIGHT', body };
}

function validateSubmission({ repo, number, headSha, event, body, comments, execute }) {
  if (typeof repo !== 'string' || !REPO_PATTERN.test(repo)) {
    throw new TypeError('repo must use OWNER/REPO format');
  }
  const validatedNumber = positiveSafeInteger(number, 'number');
  const validatedHeadSha = fullHeadSha(headSha);
  if (!EVENTS.has(event)) throw new TypeError('event must be COMMENT or APPROVE');
  const validatedBody = nonEmptyString(body, 'body');
  if (!Array.isArray(comments)) throw new TypeError('comments must be an array');
  if (typeof execute !== 'function') throw new TypeError('execute must be a function');
  return {
    repo,
    number: validatedNumber,
    headSha: validatedHeadSha,
    event,
    body: validatedBody,
    comments: comments.map(validateComment),
  };
}

function parseReviewResponse(result) {
  const stdout = typeof result === 'string' ? result : result?.stdout;
  let value;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Invalid JSON from submitted review: ${error.message}`);
  }
  if (!Number.isSafeInteger(value?.id) || value.id <= 0) {
    throw new Error('Submitted review response has no valid id');
  }
  if (typeof value.html_url !== 'string' || value.html_url.length === 0) {
    throw new Error('Submitted review response has no URL');
  }
  return { reviewId: value.id, reviewUrl: value.html_url };
}

export async function submitReview({
  repo,
  number,
  headSha,
  event,
  body,
  comments,
  execute = defaultExecute,
}) {
  const validated = validateSubmission({
    repo,
    number,
    headSha,
    event,
    body,
    comments,
    execute,
  });
  const payload = {
    commit_id: validated.headSha,
    event: validated.event,
    body: validated.body,
    comments: validated.comments,
  };
  const directory = await mkdtemp(join(tmpdir(), 'blast-radius-buddy-review-'));
  const payloadFile = join(directory, 'payload.json');

  try {
    await writeFileDefault(payloadFile, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    const response = await execute('gh', [
      'api',
      '--method',
      'POST',
      `repos/${validated.repo}/pulls/${validated.number}/reviews`,
      '--input',
      payloadFile,
    ]);
    return parseReviewResponse(response);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function usage() {
  return [
    'Usage:',
    '  github-review.mjs render --report-file REPORT.json --output BODY.md',
    '  github-review.mjs submit --repo OWNER/REPO --pr NUMBER --head-sha SHA --event COMMENT|APPROVE --body-file BODY.md --comments-file COMMENTS.json',
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

function parseJsonFile(contents, label) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

export async function main(args, dependencies = {}) {
  const [command, ...rest] = args;
  const readFile = dependencies.readFile ?? readFileDefault;
  const writeFile = dependencies.writeFile ?? writeFileDefault;
  const execute = dependencies.execute ?? defaultExecute;
  const writeStdout = dependencies.writeStdout ?? ((value) => process.stdout.write(value));

  if (command === 'render') {
    const options = readOptions(rest, new Set(['report-file', 'output']));
    const reportFile = resolve(requireOption(options, 'report-file'));
    const output = resolve(requireOption(options, 'output'));
    const report = parseJsonFile(await readFile(reportFile, 'utf8'), reportFile);
    await writeFile(output, buildReviewBody(report), 'utf8');
    return;
  }

  if (command === 'submit') {
    const options = readOptions(
      rest,
      new Set(['repo', 'pr', 'head-sha', 'event', 'body-file', 'comments-file']),
    );
    const bodyFile = resolve(requireOption(options, 'body-file'));
    const commentsFile = resolve(requireOption(options, 'comments-file'));
    const body = await readFile(bodyFile, 'utf8');
    const comments = parseJsonFile(await readFile(commentsFile, 'utf8'), commentsFile);
    const result = await submitReview({
      repo: requireOption(options, 'repo'),
      number: requireOption(options, 'pr'),
      headSha: requireOption(options, 'head-sha'),
      event: requireOption(options, 'event'),
      body,
      comments,
      execute,
    });
    writeStdout(`${JSON.stringify(result)}\n`);
    return result;
  }

  throw new Error(usage());
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
