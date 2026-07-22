#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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

import { assertHeadUnchanged } from './github-pr.mjs';
import { decideReviewEvent } from './review-protocol.mjs';

const execFileAsync = promisify(execFile);
const OPENING = "🧨 The shake is over; here's what held and what came loose.";
const VERDICTS = new Set([
  'Approve',
  'Actionable findings',
  'Review completed with uncertainty',
]);
const ACTIONABLE_SEVERITIES = new Set(['critical', 'high', 'medium']);
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const HEAD_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const FINDING_ID_PATTERN = /^BRB(?:00[1-9]|0[1-9]\d|[1-9]\d{2,5})$/;
const FINDING_MARKER_PATTERN = /<!-- blast-radius-buddy-finding:BRB(?:00[1-9]|0[1-9]\d|[1-9]\d{2,5})(?::BRBK1_[0-9a-f]{64})? -->$/;
const REPORT_FIELDS = [
  'verdict', 'headSha', 'findings', 'priorFeedback', 'validation', 'deferred', 'coverage',
];
const REPORT_FINDING_FIELDS = [
  'id', 'severity', 'confidence', 'title', 'what', 'why', 'impact', 'evidence',
  'suggestedFix', 'suggestedChange', 'mechanical',
];
const REPORT_EVIDENCE_FIELDS = ['path', 'line', 'behavior'];
const PRIOR_FEEDBACK_FIELDS = ['id', 'status', 'summary', 'path', 'line'];
const COVERAGE_FIELDS = ['security', 'blastRadius', 'featureTruth'];
const SUBMISSION_FIELDS = [
  'repo', 'number', 'report', 'diff', 'gates', 'body', 'comments', 'execute',
];

const defaultExecute = (command, args) => execFileAsync(command, args, {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactFields(value, fields, label) {
  if (!plainObject(value)) throw new TypeError(`${label} must be an object`);
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new TypeError(`${label}.${field} is required`);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new TypeError(`${label} has unexpected field ${field}`);
  }
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

function positiveSafeIntegerValue(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
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

function enumValue(value, values, label) {
  if (!values.has(value)) throw new TypeError(`${label} is unsupported`);
  return value;
}

function normalizeReportEvidence(value, label) {
  assertExactFields(value, REPORT_EVIDENCE_FIELDS, label);
  return {
    path: repositoryPath(value.path, `${label}.path`),
    line: positiveSafeIntegerValue(value.line, `${label}.line`),
    behavior: nonEmptyString(value.behavior, `${label}.behavior`),
  };
}

function normalizeReportFinding(value, index) {
  const label = `report.findings[${index}]`;
  assertExactFields(value, REPORT_FINDING_FIELDS, label);
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    throw new TypeError(`${label}.evidence must be a non-empty array`);
  }
  const suggestedChange = value.suggestedChange === null
    ? null
    : nonEmptyString(value.suggestedChange, `${label}.suggestedChange`);
  if (typeof value.mechanical !== 'boolean') {
    throw new TypeError(`${label}.mechanical must be a boolean`);
  }
  const evidence = value.evidence.map(
    (item, evidenceIndex) => normalizeReportEvidence(item, `${label}.evidence[${evidenceIndex}]`),
  );
  if (value.mechanical && suggestedChange === null) {
    throw new TypeError(`${label}.suggestedChange is required when mechanical is true`);
  }
  if (value.mechanical && new Set(evidence.map(({ path }) => path)).size !== 1) {
    throw new TypeError(`${label}.mechanical suggestion must affect one evidence path`);
  }
  return {
    id: stableFindingId(value.id, `${label}.id`),
    severity: enumValue(value.severity, ACTIONABLE_SEVERITIES, `${label}.severity`),
    confidence: enumValue(value.confidence, new Set(['high', 'medium']), `${label}.confidence`),
    title: nonEmptyString(value.title, `${label}.title`),
    what: nonEmptyString(value.what, `${label}.what`),
    why: nonEmptyString(value.why, `${label}.why`),
    impact: nonEmptyString(value.impact, `${label}.impact`),
    evidence,
    suggestedFix: nonEmptyString(value.suggestedFix, `${label}.suggestedFix`),
    suggestedChange,
    mechanical: value.mechanical,
  };
}

function normalizePriorFeedback(value, index) {
  const label = `report.priorFeedback[${index}]`;
  assertExactFields(value, PRIOR_FEEDBACK_FIELDS, label);
  const path = value.path === null ? null : repositoryPath(value.path, `${label}.path`);
  const line = value.line === null
    ? null
    : positiveSafeIntegerValue(value.line, `${label}.line`);
  if ((path === null) !== (line === null)) {
    throw new TypeError(`${label}.path and line must both be null or both be present`);
  }
  return {
    id: nonEmptyString(value.id, `${label}.id`),
    status: nonEmptyString(value.status, `${label}.status`),
    summary: nonEmptyString(value.summary, `${label}.summary`),
    path,
    line,
  };
}

function normalizeStringArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
}

export function validateNormalizedReport(value) {
  assertExactFields(value, REPORT_FIELDS, 'report');
  const verdict = enumValue(value.verdict, VERDICTS, 'report.verdict');
  const headSha = fullHeadSha(value.headSha);
  if (!Array.isArray(value.findings)) throw new TypeError('report.findings must be an array');
  if (!Array.isArray(value.priorFeedback)) {
    throw new TypeError('report.priorFeedback must be an array');
  }
  const findings = value.findings.map(normalizeReportFinding);
  const findingIds = new Set();
  for (const finding of findings) {
    if (findingIds.has(finding.id)) throw new TypeError(`duplicate finding ID ${finding.id}`);
    findingIds.add(finding.id);
  }
  const deferred = normalizeStringArray(value.deferred, 'report.deferred');
  if (verdict === 'Approve' && findings.length > 0) {
    throw new TypeError('Approve report must not contain findings');
  }
  if (verdict === 'Approve' && deferred.length > 0) {
    throw new TypeError('Approve report must not contain deferred uncertainty');
  }
  if (verdict === 'Actionable findings' && findings.length === 0) {
    throw new TypeError('Actionable findings report requires at least one finding');
  }
  if (verdict === 'Review completed with uncertainty'
    && (findings.length > 0 || deferred.length === 0)) {
    throw new TypeError(
      'Review completed with uncertainty requires no findings and at least one deferred item',
    );
  }
  assertExactFields(value.coverage, COVERAGE_FIELDS, 'report.coverage');
  return {
    verdict,
    headSha,
    findings,
    priorFeedback: value.priorFeedback.map(normalizePriorFeedback),
    validation: normalizeStringArray(value.validation, 'report.validation'),
    deferred,
    coverage: {
      security: nonEmptyString(value.coverage.security, 'report.coverage.security'),
      blastRadius: nonEmptyString(value.coverage.blastRadius, 'report.coverage.blastRadius'),
      featureTruth: nonEmptyString(value.coverage.featureTruth, 'report.coverage.featureTruth'),
    },
  };
}

function semanticText(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
    : '';
}

export function findingReviewLinkage(finding) {
  if (!plainObject(finding)) throw new TypeError('finding must be an object');
  const paths = Array.isArray(finding.evidence)
    ? [...new Set(finding.evidence
      .filter(plainObject)
      .map(({ path }) => (typeof path === 'string' ? path : ''))
      .filter((path) => path.length > 0))].sort()
    : [];
  const identity = JSON.stringify({
    paths,
    title: semanticText(finding.title),
    what: semanticText(finding.what),
  });
  return `BRBK1_${createHash('sha256').update(identity).digest('hex')}`;
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
        linkage: findingReviewLinkage(finding),
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
  const normalized = validateNormalizedReport(report);
  const { findings } = normalized;
  const headSha = normalized.headSha;
  const validation = stringItems(normalized.validation, 'report.validation');
  const deferred = stringItems(normalized.deferred, 'report.deferred');
  const coverage = {
    security: visibleText(normalized.coverage.security),
    blastRadius: visibleText(
      normalized.coverage.blastRadius,
    ),
    featureTruth: visibleText(
      normalized.coverage.featureTruth,
    ),
  };

  const lines = [
    OPENING,
    '',
    `**Verdict:** ${normalized.verdict}`,
    `**Reviewed head:** \`${headSha}\``,
  ];

  if (findings.length > 0) {
    lines.push('', '## Actionable findings', '');
    findings.forEach((finding, index) => {
      if (index > 0) lines.push('');
      lines.push(formatFinding(finding, index));
    });
  }

  const priorFeedback = normalized.priorFeedback.map(formatLedgerEntry).filter(Boolean);
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

function newDiffHeader(line) {
  if (line === '+++ /dev/null') return { recognized: true, path: null };
  const match = line.match(/^\+\+\+ b\/(.+)$/);
  if (!match) return { recognized: false, path: null };
  try {
    return { recognized: true, path: repositoryPath(match[1], 'diff path') };
  } catch {
    return { recognized: false, path: null };
  }
}

function oldDiffHeader(line) {
  if (line === '--- /dev/null') return true;
  const match = line.match(/^--- a\/(.+)$/);
  if (!match) return false;
  try {
    repositoryPath(match[1], 'old diff path');
    return true;
  } catch {
    return false;
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
  let pendingOldHeader = false;

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
    if (pendingOldHeader) {
      pendingOldHeader = false;
      const newHeader = newDiffHeader(line);
      if (newHeader.recognized) {
        flushHunk();
        currentPath = newHeader.path;
        expectsNewPath = false;
        continue;
      }
      hunk.valid = false;
    }
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
      if (hunk.valid
        && hunk.oldSeen === hunk.oldCount
        && hunk.newSeen === hunk.newCount
        && oldDiffHeader(line)) {
        pendingOldHeader = true;
        continue;
      }
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
      continue;
    }
    if (oldDiffHeader(line)) {
      currentPath = null;
      expectsNewPath = true;
      continue;
    }
    if (expectsNewPath) {
      const newHeader = newDiffHeader(line);
      currentPath = newHeader.recognized ? newHeader.path : null;
      expectsNewPath = false;
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      currentPath = null;
    }
  }
  if (pendingOldHeader && hunk) hunk.valid = false;
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
  const linkage = findingReviewLinkage(finding);
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
  lines.push('', `<!-- blast-radius-buddy-finding:${id}:${linkage} -->`);
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

export function prepareReview(report, diff, gates) {
  const normalized = validateNormalizedReport(report);
  const event = decideReviewEvent(gates);
  const reportIds = normalized.findings.map(({ id }) => id).toSorted();
  const gateIds = gates.findings.map((finding, index) => (
    stableFindingId(finding.id, `gates.findings[${index}].id`)
  )).toSorted();
  if (JSON.stringify(reportIds) !== JSON.stringify(gateIds)) {
    throw new TypeError('report findings must match gate findings');
  }
  if ((event === 'APPROVE') !== (normalized.verdict === 'Approve')) {
    throw new TypeError(`Report verdict ${normalized.verdict} contradicts gate event ${event}`);
  }
  if (normalized.verdict === 'Review completed with uncertainty'
    && gates.materialUncertainty !== true) {
    throw new TypeError('Uncertainty report requires the material uncertainty gate');
  }
  const body = buildReviewBody(normalized);
  const findings = normalized.findings;
  const changedLines = collectChangedLines(diff);
  const { inline: comments } = partitionInlineFindings(findings, changedLines);
  return { body, comments, event, headSha: normalized.headSha };
}

function validateComment(comment, index) {
  assertExactFields(comment, ['path', 'line', 'body'], `comments[${index}]`);
  const path = repositoryPath(comment.path, `comments[${index}].path`);
  const line = positiveSafeIntegerValue(comment.line, `comments[${index}].line`);
  const body = nonEmptyString(comment.body, `comments[${index}].body`);
  if (!FINDING_MARKER_PATTERN.test(body)) {
    throw new TypeError(`comments[${index}].body must end with a stable finding marker`);
  }
  return { path, line, side: 'RIGHT', body };
}

function validateSubmission(options) {
  if (!plainObject(options)) throw new TypeError('submitReview options must be an object');
  const allowed = new Set(SUBMISSION_FIELDS);
  for (const field of Object.keys(options)) {
    if (!allowed.has(field)) throw new TypeError(`submitReview has unexpected option ${field}`);
  }
  const {
    repo,
    number,
    report,
    diff,
    gates,
    body,
    comments,
    execute,
  } = options;
  if (typeof repo !== 'string' || !REPO_PATTERN.test(repo)) {
    throw new TypeError('repo must use OWNER/REPO format');
  }
  const validatedNumber = positiveSafeInteger(number, 'number');
  const validatedBody = nonEmptyString(body, 'body');
  if (!Array.isArray(comments)) throw new TypeError('comments must be an array');
  if (typeof execute !== 'function') throw new TypeError('execute must be a function');
  const recomputed = prepareReview(report, diff, gates);
  if (validatedBody !== recomputed.body
    || JSON.stringify(comments) !== JSON.stringify(recomputed.comments)) {
    throw new TypeError('Prepared review body or comments do not match source artifacts');
  }
  return {
    repo,
    number: validatedNumber,
    headSha: recomputed.headSha,
    event: recomputed.event,
    body: recomputed.body,
    comments: recomputed.comments.map(validateComment),
    execute,
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

export async function submitReview(options) {
  const validated = validateSubmission({
    ...options,
    execute: options?.execute ?? defaultExecute,
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
    await assertHeadUnchanged({
      repo: validated.repo,
      number: validated.number,
      expectedHeadSha: validated.headSha,
      execute: validated.execute,
    });
    const response = await validated.execute('gh', [
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
    '  github-review.mjs prepare --report-file REPORT.json --diff-file PR.diff --gates-file GATES.json --body-output BODY.md --comments-output COMMENTS.json',
    '  github-review.mjs render --report-file REPORT.json --output BODY.md',
    '  github-review.mjs submit --repo OWNER/REPO --pr NUMBER --report-file REPORT.json --diff-file PR.diff --gates-file GATES.json --body-file BODY.md --comments-file COMMENTS.json',
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

  if (command === 'prepare') {
    const options = readOptions(
      rest,
      new Set([
        'report-file', 'diff-file', 'gates-file',
        'body-output', 'comments-output',
      ]),
    );
    const reportFile = resolve(requireOption(options, 'report-file'));
    const diffFile = resolve(requireOption(options, 'diff-file'));
    const gatesFile = resolve(requireOption(options, 'gates-file'));
    const bodyOutput = resolve(requireOption(options, 'body-output'));
    const commentsOutput = resolve(requireOption(options, 'comments-output'));
    const [reportText, diff, gatesText] = await Promise.all([
      readFile(reportFile, 'utf8'),
      readFile(diffFile, 'utf8'),
      readFile(gatesFile, 'utf8'),
    ]);
    const report = parseJsonFile(reportText, reportFile);
    const gates = parseJsonFile(gatesText, gatesFile);
    const result = prepareReview(report, diff, gates);
    await writeFile(bodyOutput, result.body, 'utf8');
    await writeFile(commentsOutput, `${JSON.stringify(result.comments)}\n`, 'utf8');
    return result;
  }

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
      new Set([
        'repo', 'pr', 'report-file', 'diff-file', 'gates-file', 'body-file', 'comments-file',
      ]),
    );
    const reportFile = resolve(requireOption(options, 'report-file'));
    const diffFile = resolve(requireOption(options, 'diff-file'));
    const gatesFile = resolve(requireOption(options, 'gates-file'));
    const bodyFile = resolve(requireOption(options, 'body-file'));
    const commentsFile = resolve(requireOption(options, 'comments-file'));
    const [reportText, diff, gatesText, body, commentsText] = await Promise.all([
      readFile(reportFile, 'utf8'),
      readFile(diffFile, 'utf8'),
      readFile(gatesFile, 'utf8'),
      readFile(bodyFile, 'utf8'),
      readFile(commentsFile, 'utf8'),
    ]);
    const report = parseJsonFile(reportText, reportFile);
    const gates = parseJsonFile(gatesText, gatesFile);
    const comments = parseJsonFile(commentsText, commentsFile);
    const result = await submitReview({
      repo: requireOption(options, 'repo'),
      number: requireOption(options, 'pr'),
      report,
      diff,
      gates,
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
