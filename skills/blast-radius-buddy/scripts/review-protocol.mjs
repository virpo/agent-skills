#!/usr/bin/env node

import { readFile as readFileDefault } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ANGLES = new Set([
  'security-and-abuse',
  'system-blast-radius',
  'feature-truth-and-adjacent-regressions',
]);
const SEVERITIES = new Set(['critical', 'high', 'medium']);
const CONFIDENCES = new Set(['high', 'medium']);
const REPRODUCTION_VERDICTS = new Set([
  'confirmed',
  'narrowed',
  'downgraded',
  'unclear',
  'refuted',
]);
const VERIFICATION_VERDICTS = new Set(['uphold', 'modify', 'defer', 'drop', 'clean']);
const REPRODUCTION_REPORT_EFFECTS = new Set(['actionable', 'deferred', 'drop']);
const VERIFICATION_REPORT_EFFECTS = new Set(['actionable', 'deferred', 'drop', 'none']);
const FINDING_FIELDS = [
  'angle',
  'severity',
  'confidence',
  'title',
  'what',
  'why',
  'reachability',
  'impact',
  'evidence',
  'suggestedFix',
  'suggestedChange',
  'mechanical',
  'priorFeedback',
  'reporters',
  'needsRuntimeProof',
  'securitySensitive',
  'deletionSensitive',
  'scopeUncertain',
];
const EVIDENCE_FIELDS = ['path', 'line', 'behavior'];
const REPRODUCTION_RESULT_FIELDS = [
  'id',
  'verdict',
  'severity',
  'evidence',
  'reason',
  'reportEffect',
];
const CHALLENGE_FIELDS = ['target', 'evidence', 'reason', 'reportEffect'];
const PROOF_RISK_FLAGS = [
  'needsRuntimeProof',
  'securitySensitive',
  'deletionSensitive',
  'scopeUncertain',
];
const SEVERITY_RANK = new Map([
  ['critical', 0],
  ['high', 1],
  ['medium', 2],
]);
const STABLE_ID_PATTERN = /^BRB(?:00[1-9]|0[1-9]\d|[1-9]\d{2,5})$/;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, path) {
  if (!plainObject(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

function assertExactFields(value, fields, path) {
  assertObject(value, path);
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new TypeError(`${path}.${field} is required`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new TypeError(`${path} has unexpected field ${field}`);
    }
  }
}

function nonEmptyString(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function enumValue(value, allowed, path) {
  if (!allowed.has(value)) {
    throw new TypeError(`${path} is unsupported`);
  }
  return value;
}

function booleanValue(value, path) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${path} must be a boolean`);
  }
  return value;
}

function isRepoRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return false;
  if (value.includes('\\') || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function repositoryPath(value, path) {
  if (!isRepoRelativePath(value)) {
    throw new TypeError(`${path} must be a repository-relative path`);
  }
  return value;
}

function positiveLine(value, path) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive safe integer`);
  }
  return value;
}

function stableFindingId(value, path) {
  if (typeof value !== 'string' || !STABLE_ID_PATTERN.test(value)) {
    throw new TypeError(`${path} must be a stable finding ID`);
  }
  return value;
}

function normalizeEvidence(value, path) {
  assertExactFields(value, EVIDENCE_FIELDS, path);
  return {
    path: repositoryPath(value.path, `${path}.path`),
    line: positiveLine(value.line, `${path}.line`),
    behavior: nonEmptyString(value.behavior, `${path}.behavior`),
  };
}

function normalizeFinding(value, path) {
  assertExactFields(value, FINDING_FIELDS, path);
  if (!Array.isArray(value.evidence)) {
    throw new TypeError(`${path}.evidence must be an array`);
  }
  if (!Array.isArray(value.reporters) || value.reporters.length === 0) {
    throw new TypeError(`${path}.reporters must be a non-empty array`);
  }
  const reporters = value.reporters.map(
    (reporter, index) => nonEmptyString(reporter, `${path}.reporters[${index}]`),
  );
  const suggestedChange = value.suggestedChange === null
    ? null
    : nonEmptyString(value.suggestedChange, `${path}.suggestedChange`);
  if (value.priorFeedback !== null) {
    throw new TypeError(`${path}.priorFeedback must be null`);
  }

  return {
    angle: enumValue(value.angle, ANGLES, `${path}.angle`),
    severity: enumValue(value.severity, SEVERITIES, `${path}.severity`),
    confidence: enumValue(value.confidence, CONFIDENCES, `${path}.confidence`),
    title: nonEmptyString(value.title, `${path}.title`),
    what: nonEmptyString(value.what, `${path}.what`),
    why: nonEmptyString(value.why, `${path}.why`),
    reachability: nonEmptyString(value.reachability, `${path}.reachability`),
    impact: nonEmptyString(value.impact, `${path}.impact`),
    evidence: value.evidence.map(
      (item, index) => normalizeEvidence(item, `${path}.evidence[${index}]`),
    ),
    suggestedFix: nonEmptyString(value.suggestedFix, `${path}.suggestedFix`),
    suggestedChange,
    mechanical: booleanValue(value.mechanical, `${path}.mechanical`),
    priorFeedback: null,
    reporters,
    needsRuntimeProof: booleanValue(value.needsRuntimeProof, `${path}.needsRuntimeProof`),
    securitySensitive: booleanValue(value.securitySensitive, `${path}.securitySensitive`),
    deletionSensitive: booleanValue(value.deletionSensitive, `${path}.deletionSensitive`),
    scopeUncertain: booleanValue(value.scopeUncertain, `${path}.scopeUncertain`),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseProtocolBlock(text, label) {
  if (typeof text !== 'string') {
    throw new TypeError('Protocol output must be a string');
  }
  if (typeof label !== 'string' || !/^[A-Za-z0-9-]+$/.test(label)) {
    throw new TypeError('Protocol label is invalid');
  }
  const escapedLabel = escapeRegExp(label);
  const match = text.match(new RegExp(
    `^\\s*\`\`\`${escapedLabel}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\`[ \\t]*\\s*$`,
  ));
  if (!match) {
    throw new Error(`Expected exactly one final fenced ${label} JSON block`);
  }

  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} block: ${error.message}`);
  }
}

export function validateReviewResult(value) {
  assertObject(value, 'review');
  if (value.status === 'complete') {
    assertExactFields(value, ['status', 'findings'], 'review');
    if (!Array.isArray(value.findings)) {
      throw new TypeError('review.findings must be an array');
    }
    return {
      status: 'complete',
      findings: value.findings.map(
        (finding, index) => normalizeFinding(finding, `findings[${index}]`),
      ),
    };
  }
  if (value.status === 'needs-context') {
    assertExactFields(value, ['status', 'missingContext'], 'review');
    if (!Array.isArray(value.missingContext) || value.missingContext.length === 0) {
      throw new TypeError('review.missingContext must be a non-empty array');
    }
    return {
      status: 'needs-context',
      missingContext: value.missingContext.map(
        (item, index) => nonEmptyString(item, `review.missingContext[${index}]`),
      ),
    };
  }
  throw new TypeError('review.status is unsupported');
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareFindings(left, right) {
  const severity = SEVERITY_RANK.get(left.severity) - SEVERITY_RANK.get(right.severity);
  if (severity !== 0) return severity;
  const leftEvidence = left.evidence[0];
  const rightEvidence = right.evidence[0];
  const path = compareText(leftEvidence?.path ?? '', rightEvidence?.path ?? '');
  if (path !== 0) return path;
  const line = (leftEvidence?.line ?? 0) - (rightEvidence?.line ?? 0);
  if (line !== 0) return line;
  const title = compareText(left.title, right.title);
  if (title !== 0) return title;
  return compareText(JSON.stringify(left), JSON.stringify(right));
}

export function assignStableIds(findings) {
  if (!Array.isArray(findings)) {
    throw new TypeError('findings must be an array');
  }
  if (findings.length > 999_999) {
    throw new TypeError('findings must contain at most 999999 items');
  }
  const normalized = validateReviewResult({ status: 'complete', findings }).findings;
  return normalized
    .toSorted(compareFindings)
    .map((finding, index) => ({
      ...finding,
      id: `BRB${String(index + 1).padStart(3, '0')}`,
    }));
}

function directEvidence(evidence) {
  return Array.isArray(evidence)
    && evidence.length > 0
    && evidence.every((item) => plainObject(item)
      && isRepoRelativePath(item.path)
      && Number.isSafeInteger(item.line)
      && item.line > 0
      && typeof item.behavior === 'string'
      && item.behavior.trim().length > 0);
}

export function selectReproductionCandidates(findings) {
  if (!Array.isArray(findings)) {
    throw new TypeError('findings must be an array');
  }
  return findings.filter((finding, index) => {
    assertObject(finding, `findings[${index}]`);
    stableFindingId(finding.id, `findings[${index}].id`);
    const reporters = Array.isArray(finding.reporters)
      ? new Set(finding.reporters.filter((reporter) => typeof reporter === 'string' && reporter.length > 0))
      : new Set();
    if (PROOF_RISK_FLAGS.some((flag) => finding[flag] === true)) return true;
    if (reporters.size === 1) return SEVERITIES.has(finding.severity);
    return reporters.size < 2 || !directEvidence(finding.evidence);
  });
}

function normalizeReproductionItem(value, path) {
  assertExactFields(value, REPRODUCTION_RESULT_FIELDS, path);
  return {
    id: stableFindingId(value.id, `${path}.id`),
    verdict: enumValue(value.verdict, REPRODUCTION_VERDICTS, `${path}.verdict`),
    severity: enumValue(value.severity, SEVERITIES, `${path}.severity`),
    evidence: nonEmptyString(value.evidence, `${path}.evidence`),
    reason: nonEmptyString(value.reason, `${path}.reason`),
    reportEffect: enumValue(
      value.reportEffect,
      REPRODUCTION_REPORT_EFFECTS,
      `${path}.reportEffect`,
    ),
  };
}

export function validateReproductionResult(value) {
  assertExactFields(value, ['results'], 'reproduction');
  if (!Array.isArray(value.results)) {
    throw new TypeError('reproduction.results must be an array');
  }
  return {
    results: value.results.map(
      (item, index) => normalizeReproductionItem(item, `results[${index}]`),
    ),
  };
}

function normalizeChallenge(value, path) {
  assertExactFields(value, CHALLENGE_FIELDS, path);
  const target = value.target === 'approval'
    ? 'approval'
    : stableFindingId(value.target, `${path}.target`);
  return {
    target,
    evidence: nonEmptyString(value.evidence, `${path}.evidence`),
    reason: nonEmptyString(value.reason, `${path}.reason`),
    reportEffect: enumValue(
      value.reportEffect,
      VERIFICATION_REPORT_EFFECTS,
      `${path}.reportEffect`,
    ),
  };
}

export function validateVerificationResult(value) {
  assertExactFields(value, ['verdict', 'challenges'], 'verification');
  if (!Array.isArray(value.challenges)) {
    throw new TypeError('verification.challenges must be an array');
  }
  return {
    verdict: enumValue(value.verdict, VERIFICATION_VERDICTS, 'verification.verdict'),
    challenges: value.challenges.map(
      (challenge, index) => normalizeChallenge(challenge, `challenges[${index}]`),
    ),
  };
}

export function decideReviewEvent({
  reviewersComplete,
  reproductionComplete,
  materialUncertainty,
  verifierVerdict,
  findings,
  failedRequiredChecks,
  headUnchanged,
}) {
  if (!headUnchanged || !reviewersComplete || !reproductionComplete) {
    throw new Error('Review is incomplete; update the marker only');
  }
  if (findings.length > 0
    || materialUncertainty
    || verifierVerdict !== 'clean'
    || failedRequiredChecks.length > 0) {
    return 'COMMENT';
  }
  return 'APPROVE';
}

function usage() {
  return [
    'Usage:',
    '  review-protocol.mjs validate --kind review|reproduction|verification --input FILE',
    '  review-protocol.mjs select-reproduction --input SYNTHESIS.json',
    '  review-protocol.mjs decide-event --input GATES.json',
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

function parseJsonInput(text, input) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${input}: ${error.message}`);
  }
}

export async function main(args, dependencies = {}) {
  const [command, ...rest] = args;
  const readFile = dependencies.readFile ?? readFileDefault;
  const writeStdout = dependencies.writeStdout ?? ((value) => process.stdout.write(value));
  let result;

  if (command === 'validate') {
    const options = readOptions(rest, new Set(['kind', 'input']));
    const kind = requireOption(options, 'kind');
    const input = requireOption(options, 'input');
    const validators = {
      review: validateReviewResult,
      reproduction: validateReproductionResult,
      verification: validateVerificationResult,
    };
    const validate = validators[kind];
    if (!validate) throw new Error(usage());
    const text = await readFile(input, 'utf8');
    result = validate(parseProtocolBlock(text, `brb-${kind}`));
    writeStdout(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === 'select-reproduction') {
    const options = readOptions(rest, new Set(['input']));
    const input = requireOption(options, 'input');
    const parsed = parseJsonInput(await readFile(input, 'utf8'), input);
    let findings;
    if (Array.isArray(parsed)) {
      findings = parsed;
    } else {
      assertExactFields(parsed, ['findings'], 'synthesis');
      findings = parsed.findings;
    }
    result = selectReproductionCandidates(findings);
    writeStdout(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === 'decide-event') {
    const options = readOptions(rest, new Set(['input']));
    const input = requireOption(options, 'input');
    const gates = parseJsonInput(await readFile(input, 'utf8'), input);
    result = decideReviewEvent(gates);
    writeStdout(`${result}\n`);
    return;
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
