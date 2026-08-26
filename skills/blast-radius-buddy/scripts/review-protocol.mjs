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
const REPRODUCTION_EFFECTS_BY_VERDICT = new Map([
  ['confirmed', new Set(['actionable'])],
  ['narrowed', new Set(['actionable'])],
  ['downgraded', new Set(['actionable', 'drop'])],
  ['unclear', new Set(['deferred'])],
  ['refuted', new Set(['drop'])],
]);
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
const SUGGESTION_FIELDS = [
  'angle', 'confidence', 'title', 'improvement', 'benefit', 'evidence',
  'suggestedChange', 'mechanical', 'priorFeedback', 'reporters',
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
const REVIEW_GATE_FIELDS = [
  'reviewersComplete',
  'reproductionComplete',
  'materialUncertainty',
  'verifierVerdict',
  'findings',
  'suggestions',
  'failedRequiredChecks',
  'headUnchanged',
];
const SYNTHESIS_FIELDS = [
  'status', 'headSha', 'triggerId', 'event', 'report', 'gates', 'verification',
];
const SYNTHESIS_COVERAGE_FIELDS = ['security', 'blastRadius', 'featureTruth'];
const REVIEW_EVENTS = new Set(['COMMENT', 'APPROVE']);
const PLAN_RISKS = new Set(['low', 'medium', 'high']);
const PLAN_DISPOSITIONS = new Set(['material', 'mechanical', 'low-risk']);
const PLAN_PROVIDERS = new Set(['codex', 'claude']);
const PLAN_FIELDS = [
  'status', 'headSha', 'triggerId', 'intent', 'boundaries', 'clusters',
  'fileDispositions', 'assignments', 'missingContext',
];
const PLAN_CLUSTER_FIELDS = [
  'id', 'risk', 'reason', 'changedFiles', 'relatedFiles', 'tests',
];
const PLAN_DISPOSITION_FIELDS = ['path', 'disposition', 'clusterId', 'reason'];
const PLAN_ASSIGNMENT_FIELDS = ['angle', 'provider', 'reason'];
const SEVERITY_RANK = new Map([
  ['critical', 0],
  ['high', 1],
  ['medium', 2],
]);
const STABLE_ID_PATTERN = /^BRB(?:00[1-9]|0[1-9]\d|[1-9]\d{2,5})$/;
const SUGGESTION_ID_PATTERN = /^BRS(?:00[1-9]|0[1-9]\d|[1-9]\d{2,5})$/;

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

function stableSuggestionId(value, path) {
  if (typeof value !== 'string' || !SUGGESTION_ID_PATTERN.test(value)) {
    throw new TypeError(`${path} must be a stable suggestion ID`);
  }
  return value;
}

export function validateExpectedReproductionIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('expected reproduction IDs must be a non-empty array');
  }
  const expectedIds = value.map(
    (id, index) => stableFindingId(id, `expected reproduction IDs[${index}]`),
  );
  if (new Set(expectedIds).size !== expectedIds.length) {
    throw new TypeError('expected reproduction IDs must be unique');
  }
  return expectedIds;
}

export function validateExpectedVerificationIds(value) {
  if (!Array.isArray(value)) {
    throw new TypeError('expected verification IDs must be an array');
  }
  if (value.length > 3) {
    throw new TypeError('expected verification IDs must contain at most 3 items');
  }
  const expectedIds = value.map(
    (id, index) => stableSuggestionId(id, `expected verification IDs[${index}]`),
  );
  if (new Set(expectedIds).size !== expectedIds.length) {
    throw new TypeError('expected verification IDs must be unique');
  }
  return expectedIds;
}

function normalizeEvidence(value, path) {
  assertExactFields(value, EVIDENCE_FIELDS, path);
  return {
    path: repositoryPath(value.path, `${path}.path`),
    line: positiveLine(value.line, `${path}.line`),
    behavior: nonEmptyString(value.behavior, `${path}.behavior`),
  };
}

function assignedAngle(value) {
  if (typeof value !== 'string' || !ANGLES.has(value)) {
    throw new TypeError('expected angle must be an approved review angle');
  }
  return value;
}

function normalizeSynthesisReporters(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty array`);
  }
  const reporters = value.map(
    (reporter, index) => enumValue(reporter, ANGLES, `${path}[${index}]`),
  );
  if (new Set(reporters).size !== reporters.length) {
    throw new TypeError(`${path} must contain unique approved angles`);
  }
  return reporters;
}

function normalizeFinding(value, path, expectedAngle) {
  assertExactFields(value, FINDING_FIELDS, path);
  if (!Array.isArray(value.evidence)) {
    throw new TypeError(`${path}.evidence must be an array`);
  }
  if (!Array.isArray(value.reporters)) {
    throw new TypeError(`${path}.reporters must be an array`);
  }
  const angle = enumValue(value.angle, ANGLES, `${path}.angle`);
  let reporters;
  if (expectedAngle !== undefined) {
    if (angle !== expectedAngle) {
      throw new TypeError(`${path}.angle must match the assigned angle ${expectedAngle}`);
    }
    if (value.reporters.length !== 1 || value.reporters[0] !== expectedAngle) {
      throw new TypeError(
        `${path}.reporters must contain exactly one reporter matching the assigned angle`,
      );
    }
    reporters = [expectedAngle];
  } else {
    reporters = normalizeSynthesisReporters(value.reporters, `${path}.reporters`);
  }
  const suggestedChange = value.suggestedChange === null
    ? null
    : nonEmptyString(value.suggestedChange, `${path}.suggestedChange`);
  if (value.priorFeedback !== null) {
    throw new TypeError(`${path}.priorFeedback must be null`);
  }

  return {
    angle,
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

function normalizeSuggestion(value, path, expectedAngle) {
  assertExactFields(value, SUGGESTION_FIELDS, path);
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    throw new TypeError(`${path}.evidence must be a non-empty array`);
  }
  if (!Array.isArray(value.reporters)) {
    throw new TypeError(`${path}.reporters must be an array`);
  }
  const angle = enumValue(value.angle, ANGLES, `${path}.angle`);
  let reporters;
  if (expectedAngle !== undefined) {
    if (angle !== expectedAngle) {
      throw new TypeError(`${path}.angle must match the assigned angle ${expectedAngle}`);
    }
    if (value.reporters.length !== 1 || value.reporters[0] !== expectedAngle) {
      throw new TypeError(
        `${path}.reporters must contain exactly one reporter matching the assigned angle`,
      );
    }
    reporters = [expectedAngle];
  } else {
    reporters = normalizeSynthesisReporters(value.reporters, `${path}.reporters`);
  }
  if (value.confidence !== 'high') {
    throw new TypeError(`${path}.confidence must be high`);
  }
  const suggestedChange = value.suggestedChange === null
    ? null
    : nonEmptyString(value.suggestedChange, `${path}.suggestedChange`);
  if (value.priorFeedback !== null) {
    throw new TypeError(`${path}.priorFeedback must be null`);
  }

  return {
    angle,
    confidence: 'high',
    title: nonEmptyString(value.title, `${path}.title`),
    improvement: nonEmptyString(value.improvement, `${path}.improvement`),
    benefit: nonEmptyString(value.benefit, `${path}.benefit`),
    evidence: value.evidence.map(
      (item, index) => normalizeEvidence(item, `${path}.evidence[${index}]`),
    ),
    suggestedChange,
    mechanical: booleanValue(value.mechanical, `${path}.mechanical`),
    priorFeedback: null,
    reporters,
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
  } catch {
    throw new Error(`Invalid JSON in ${label} block`);
  }
}

function uniqueRepositoryPaths(value, path, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${path} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  }
  const paths = value.map((item, index) => repositoryPath(item, `${path}[${index}]`));
  if (new Set(paths).size !== paths.length) {
    throw new TypeError(`${path} must contain unique repository paths`);
  }
  return paths;
}

function nonEmptyStrings(value, path, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${path} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  }
  return value.map((item, index) => nonEmptyString(item, `${path}[${index}]`));
}

function validatePlanIdentity(value, expected) {
  assertObject(expected, 'expected plan identity');
  const expectedHeadSha = fullHeadSha(expected.headSha, 'expected headSha');
  const expectedTriggerId = nonEmptyString(expected.triggerId, 'expected triggerId');
  const headSha = fullHeadSha(value.headSha, 'plan.headSha');
  const triggerId = nonEmptyString(value.triggerId, 'plan.triggerId');
  if (headSha !== expectedHeadSha) throw new TypeError('plan head does not match captured head');
  if (triggerId !== expectedTriggerId) {
    throw new TypeError('plan trigger does not match queued trigger');
  }
  return { headSha, triggerId };
}

export function validateReviewPlan(value, expected) {
  assertObject(value, 'plan');
  const { headSha, triggerId } = validatePlanIdentity(value, expected);
  const changedFiles = uniqueRepositoryPaths(
    expected.changedFiles,
    'expected changed files',
    { allowEmpty: false },
  );
  if (value.status === 'needs-context') {
    assertExactFields(value, ['status', 'headSha', 'triggerId', 'missingContext'], 'plan');
    return {
      status: 'needs-context',
      headSha,
      triggerId,
      missingContext: nonEmptyStrings(value.missingContext, 'plan.missingContext'),
    };
  }
  if (value.status !== 'complete') throw new TypeError('plan.status is unsupported');
  assertExactFields(value, PLAN_FIELDS, 'plan');
  if (!Array.isArray(value.missingContext) || value.missingContext.length !== 0) {
    throw new TypeError('plan.missingContext must be an empty array for a complete plan');
  }
  if (!Array.isArray(value.clusters)) throw new TypeError('plan.clusters must be an array');
  const clusterIds = new Set();
  const clusters = value.clusters.map((cluster, index) => {
    const path = `plan.clusters[${index}]`;
    assertExactFields(cluster, PLAN_CLUSTER_FIELDS, path);
    const id = nonEmptyString(cluster.id, `${path}.id`);
    if (!/^cluster-[1-9]\d*$/.test(id)) {
      throw new TypeError(`${path}.id must use cluster-N format`);
    }
    if (clusterIds.has(id)) throw new TypeError('plan.clusters must contain unique IDs');
    clusterIds.add(id);
    return {
      id,
      risk: enumValue(cluster.risk, PLAN_RISKS, `${path}.risk`),
      reason: nonEmptyString(cluster.reason, `${path}.reason`),
      changedFiles: uniqueRepositoryPaths(
        cluster.changedFiles,
        `${path}.changedFiles`,
        { allowEmpty: false },
      ),
      relatedFiles: uniqueRepositoryPaths(cluster.relatedFiles, `${path}.relatedFiles`),
      tests: uniqueRepositoryPaths(cluster.tests, `${path}.tests`),
    };
  });
  if (!Array.isArray(value.fileDispositions)) {
    throw new TypeError('plan.fileDispositions must be an array');
  }
  const dispositionPaths = new Set();
  const fileDispositions = value.fileDispositions.map((item, index) => {
    const path = `plan.fileDispositions[${index}]`;
    assertExactFields(item, PLAN_DISPOSITION_FIELDS, path);
    const file = repositoryPath(item.path, `${path}.path`);
    if (dispositionPaths.has(file)) {
      throw new TypeError(`plan.fileDispositions has duplicate path ${file}`);
    }
    dispositionPaths.add(file);
    const disposition = enumValue(
      item.disposition,
      PLAN_DISPOSITIONS,
      `${path}.disposition`,
    );
    let clusterId = null;
    if (disposition === 'material') {
      clusterId = nonEmptyString(item.clusterId, `${path}.clusterId`);
      if (!clusterIds.has(clusterId)) {
        throw new TypeError(`${path}.clusterId references an unknown cluster`);
      }
    } else if (item.clusterId !== null) {
      throw new TypeError(`${path}.clusterId must be null outside material disposition`);
    }
    return {
      path: file,
      disposition,
      clusterId,
      reason: nonEmptyString(item.reason, `${path}.reason`),
    };
  });
  const expectedSet = new Set(changedFiles);
  const missing = changedFiles.filter((path) => !dispositionPaths.has(path));
  const unexpected = [...dispositionPaths].filter((path) => !expectedSet.has(path));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new TypeError(
      `plan file dispositions must match changed files; missing=${missing.join(',')}; unexpected=${unexpected.join(',')}`,
    );
  }
  for (const cluster of clusters) {
    for (const file of cluster.changedFiles) {
      const disposition = fileDispositions.find((item) => item.path === file);
      if (!disposition || disposition.disposition !== 'material'
        || disposition.clusterId !== cluster.id) {
        throw new TypeError(`plan cluster ${cluster.id} has an unbound changed file ${file}`);
      }
    }
  }
  for (const disposition of fileDispositions.filter((item) => item.disposition === 'material')) {
    const cluster = clusters.find((item) => item.id === disposition.clusterId);
    if (!cluster.changedFiles.includes(disposition.path)) {
      throw new TypeError(`plan material file ${disposition.path} is absent from its cluster`);
    }
  }
  if (!Array.isArray(value.assignments) || value.assignments.length !== ANGLES.size) {
    throw new TypeError('plan.assignments must contain exactly three items');
  }
  const assignments = value.assignments.map((item, index) => {
    const path = `plan.assignments[${index}]`;
    assertExactFields(item, PLAN_ASSIGNMENT_FIELDS, path);
    return {
      angle: enumValue(item.angle, ANGLES, `${path}.angle`),
      provider: enumValue(item.provider, PLAN_PROVIDERS, `${path}.provider`),
      reason: nonEmptyString(item.reason, `${path}.reason`),
    };
  });
  if (new Set(assignments.map(({ angle }) => angle)).size !== ANGLES.size) {
    throw new TypeError('plan.assignments must cover every canonical angle exactly once');
  }
  if (assignments.filter(({ provider }) => provider === 'claude').length !== 1
    || assignments.filter(({ provider }) => provider === 'codex').length !== 2) {
    throw new TypeError('plan.assignments must contain exactly two Codex and one Claude');
  }
  return {
    status: 'complete',
    headSha,
    triggerId,
    intent: nonEmptyString(value.intent, 'plan.intent'),
    boundaries: nonEmptyStrings(value.boundaries, 'plan.boundaries'),
    clusters,
    fileDispositions,
    assignments,
    missingContext: [],
  };
}

export function validateReviewResult(value, expectedAngle) {
  const normalizedExpectedAngle = assignedAngle(expectedAngle);
  assertObject(value, 'review');
  if (value.status === 'complete') {
    assertExactFields(value, ['status', 'findings', 'suggestions'], 'review');
    if (!Array.isArray(value.findings)) {
      throw new TypeError('review.findings must be an array');
    }
    if (!Array.isArray(value.suggestions)) {
      throw new TypeError('review.suggestions must be an array');
    }
    if (value.suggestions.length > 1) {
      throw new TypeError('review.suggestions must contain at most one item');
    }
    return {
      status: 'complete',
      findings: value.findings.map(
        (finding, index) => normalizeFinding(
          finding,
          `findings[${index}]`,
          normalizedExpectedAngle,
        ),
      ),
      suggestions: value.suggestions.map(
        (suggestion, index) => normalizeSuggestion(
          suggestion,
          `suggestions[${index}]`,
          normalizedExpectedAngle,
        ),
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

function compareSuggestions(left, right) {
  const leftEvidence = left.evidence?.[0];
  const rightEvidence = right.evidence?.[0];
  const path = compareText(leftEvidence?.path ?? '', rightEvidence?.path ?? '');
  if (path !== 0) return path;
  const line = (leftEvidence?.line ?? 0) - (rightEvidence?.line ?? 0);
  if (line !== 0) return line;
  const title = compareText(left.title ?? '', right.title ?? '');
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
  const normalized = findings.map(
    (finding, index) => normalizeFinding(finding, `findings[${index}]`),
  );
  return normalized
    .toSorted(compareFindings)
    .map((finding, index) => ({
      ...finding,
      id: `BRB${String(index + 1).padStart(3, '0')}`,
    }));
}

export function assignSuggestionIds(suggestions) {
  if (!Array.isArray(suggestions) || suggestions.length > 3) {
    throw new TypeError('suggestions must contain at most 3 items');
  }
  return suggestions.toSorted(compareSuggestions).map((suggestion, index) => ({
    ...normalizeSuggestion(suggestion, `suggestions[${index}]`),
    id: `BRS${String(index + 1).padStart(3, '0')}`,
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
    const reporters = new Set(normalizeSynthesisReporters(
      finding.reporters,
      `findings[${index}].reporters`,
    ));
    if (PROOF_RISK_FLAGS.some((flag) => finding[flag] === true)) return true;
    if (reporters.size === 1) return SEVERITIES.has(finding.severity);
    return reporters.size < 2 || !directEvidence(finding.evidence);
  });
}

function normalizeReproductionItem(value, path) {
  assertExactFields(value, REPRODUCTION_RESULT_FIELDS, path);
  const verdict = enumValue(value.verdict, REPRODUCTION_VERDICTS, `${path}.verdict`);
  const reportEffect = enumValue(
    value.reportEffect,
    REPRODUCTION_REPORT_EFFECTS,
    `${path}.reportEffect`,
  );
  if (!REPRODUCTION_EFFECTS_BY_VERDICT.get(verdict).has(reportEffect)) {
    throw new TypeError(`${path}.reportEffect is incompatible with verdict ${verdict}`);
  }
  return {
    id: stableFindingId(value.id, `${path}.id`),
    verdict,
    severity: enumValue(value.severity, SEVERITIES, `${path}.severity`),
    evidence: nonEmptyString(value.evidence, `${path}.evidence`),
    reason: nonEmptyString(value.reason, `${path}.reason`),
    reportEffect,
  };
}

export function validateReproductionResult(value, expectedIds) {
  const normalizedExpectedIds = validateExpectedReproductionIds(expectedIds);
  assertExactFields(value, ['results'], 'reproduction');
  if (!Array.isArray(value.results)) {
    throw new TypeError('reproduction.results must be an array');
  }
  const expected = new Set(normalizedExpectedIds);
  const byId = new Map();
  value.results.forEach((item, index) => {
    const normalized = normalizeReproductionItem(item, `results[${index}]`);
    if (!expected.has(normalized.id)) {
      throw new TypeError(`reproduction.results has unexpected ID ${normalized.id}`);
    }
    if (byId.has(normalized.id)) {
      throw new TypeError(`reproduction.results has duplicate ID ${normalized.id}`);
    }
    byId.set(normalized.id, normalized);
  });
  for (const id of normalizedExpectedIds) {
    if (!byId.has(id)) {
      throw new TypeError(`reproduction.results is missing expected ID ${id}`);
    }
  }
  return {
    results: normalizedExpectedIds.map((id) => byId.get(id)),
  };
}

function normalizeChallenge(value, path) {
  assertExactFields(value, CHALLENGE_FIELDS, path);
  let target;
  if (value.target === 'approval') {
    target = 'approval';
  } else if (typeof value.target === 'string' && SUGGESTION_ID_PATTERN.test(value.target)) {
    target = stableSuggestionId(value.target, `${path}.target`);
  } else {
    target = stableFindingId(value.target, `${path}.target`);
  }
  const reportEffect = enumValue(
    value.reportEffect,
    VERIFICATION_REPORT_EFFECTS,
    `${path}.reportEffect`,
  );
  if (target !== 'approval'
    && SUGGESTION_ID_PATTERN.test(target)
    && reportEffect === 'deferred') {
    throw new TypeError(`${path}.reportEffect is incompatible with BRS target`);
  }
  return {
    target,
    evidence: nonEmptyString(value.evidence, `${path}.evidence`),
    reason: nonEmptyString(value.reason, `${path}.reason`),
    reportEffect,
  };
}

export function validateVerificationResult(value, expectedIds) {
  const normalizedExpectedIds = validateExpectedVerificationIds(expectedIds);
  assertExactFields(value, ['verdict', 'challenges'], 'verification');
  if (!Array.isArray(value.challenges)) {
    throw new TypeError('verification.challenges must be an array');
  }
  const verdict = enumValue(value.verdict, VERIFICATION_VERDICTS, 'verification.verdict');
  const challenges = value.challenges.map(
    (challenge, index) => normalizeChallenge(challenge, `challenges[${index}]`),
  );
  const expected = new Set(normalizedExpectedIds);
  const classified = new Set();
  for (const challenge of challenges) {
    if (!SUGGESTION_ID_PATTERN.test(challenge.target)) continue;
    if (!expected.has(challenge.target)) {
      throw new TypeError(`verification.challenges has unexpected ID ${challenge.target}`);
    }
    if (classified.has(challenge.target)) {
      throw new TypeError(`verification.challenges has duplicate ID ${challenge.target}`);
    }
    classified.add(challenge.target);
  }
  for (const id of normalizedExpectedIds) {
    if (!classified.has(id)) {
      throw new TypeError(`verification.challenges is missing expected ID ${id}`);
    }
  }
  const effects = new Set(challenges.map(({ reportEffect }) => reportEffect));
  const cleanHasReportChange = challenges.some(({ target, reportEffect }) => (
    reportEffect !== 'none'
    && !(reportEffect === 'drop' && SUGGESTION_ID_PATTERN.test(target))
  ));
  const incompatible = (
    (verdict === 'uphold' && [...effects].some((effect) => effect !== 'none'))
    || (verdict === 'clean' && cleanHasReportChange)
    || (verdict === 'modify'
      && (challenges.length === 0 || ![...effects].some((effect) => effect !== 'none')))
    || (verdict === 'defer' && !effects.has('deferred'))
    || (verdict === 'drop' && !effects.has('drop'))
  );
  if (incompatible) {
    throw new TypeError(`verification.challenges are incompatible with verdict ${verdict}`);
  }
  return { verdict, challenges };
}

function fullHeadSha(value, path) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new TypeError(`${path} must be a full 40-character commit SHA`);
  }
  return value;
}

function validateSynthesisIdentity(value, expected) {
  assertObject(expected, 'expected synthesis identity');
  const expectedHeadSha = fullHeadSha(expected.headSha, 'expected headSha');
  const expectedTriggerId = nonEmptyString(expected.triggerId, 'expected triggerId');
  const headSha = fullHeadSha(value.headSha, 'synthesis.headSha');
  const triggerId = nonEmptyString(value.triggerId, 'synthesis.triggerId');
  if (headSha !== expectedHeadSha) {
    throw new TypeError('synthesis head does not match captured head');
  }
  if (triggerId !== expectedTriggerId) {
    throw new TypeError('synthesis trigger does not match queued trigger');
  }
  return { headSha, triggerId };
}

export function validateSynthesisResult(value, expected) {
  assertObject(value, 'synthesis');
  if (value.status === 'needs-context') {
    assertExactFields(
      value,
      ['status', 'headSha', 'triggerId', 'missingContext'],
      'synthesis',
    );
    const { headSha, triggerId } = validateSynthesisIdentity(value, expected);
    if (!Array.isArray(value.missingContext) || value.missingContext.length === 0) {
      throw new TypeError('synthesis.missingContext must be a non-empty array');
    }
    return {
      status: 'needs-context',
      headSha,
      triggerId,
      missingContext: value.missingContext.map(
        (item, index) => nonEmptyString(item, `synthesis.missingContext[${index}]`),
      ),
    };
  }
  if (value.status !== 'complete') {
    throw new TypeError('synthesis.status is unsupported');
  }
  assertExactFields(value, SYNTHESIS_FIELDS, 'synthesis');
  const { headSha, triggerId } = validateSynthesisIdentity(value, expected);
  if (!REVIEW_EVENTS.has(value.event)) {
    throw new TypeError('synthesis.event must be COMMENT or APPROVE');
  }
  const event = value.event;
  assertObject(value.report, 'synthesis.report');
  if (value.report.headSha !== headSha) {
    throw new TypeError('synthesis.report.headSha must match synthesis.headSha');
  }
  assertExactFields(
    value.report.coverage,
    SYNTHESIS_COVERAGE_FIELDS,
    'synthesis.report.coverage',
  );
  for (const field of SYNTHESIS_COVERAGE_FIELDS) {
    nonEmptyString(value.report.coverage[field], `synthesis.report.coverage.${field}`);
  }
  assertObject(value.gates, 'synthesis.gates');
  const deterministicEvent = decideReviewEvent(value.gates);
  if (event !== deterministicEvent) {
    throw new TypeError('synthesis.event does not match the deterministic gate event');
  }
  const findingIds = value.gates.findings.map(
    (finding, index) => stableFindingId(finding.id, `synthesis.gates.findings[${index}].id`),
  );
  if (new Set(findingIds).size !== findingIds.length) {
    throw new TypeError('synthesis.gates.findings must contain unique stable IDs');
  }
  assertObject(value.verification, 'synthesis.verification');
  return {
    status: 'complete',
    headSha,
    triggerId,
    event,
    report: value.report,
    gates: value.gates,
    verification: value.verification,
  };
}

function validReviewGateEnvelope(value) {
  if (!plainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== REVIEW_GATE_FIELDS.length
    || keys.some((key) => typeof key !== 'string' || !REVIEW_GATE_FIELDS.includes(key))
    || REVIEW_GATE_FIELDS.some((field) => !Object.hasOwn(value, field))) {
    return false;
  }
  if (typeof value.reviewersComplete !== 'boolean'
    || typeof value.reproductionComplete !== 'boolean'
    || typeof value.materialUncertainty !== 'boolean'
    || typeof value.headUnchanged !== 'boolean'
    || !VERIFICATION_VERDICTS.has(value.verifierVerdict)
    || !Array.isArray(value.findings)
    || !value.findings.every((finding) => plainObject(finding))
    || !Array.isArray(value.suggestions)
    || value.suggestions.length > 3
    || !value.suggestions.every((suggestion) => {
      if (!plainObject(suggestion)) return false;
      const suggestionKeys = Reflect.ownKeys(suggestion);
      return suggestionKeys.length === 1
        && suggestionKeys[0] === 'id'
        && typeof suggestion.id === 'string'
        && SUGGESTION_ID_PATTERN.test(suggestion.id);
    })
    || !Array.isArray(value.failedRequiredChecks)
    || !value.failedRequiredChecks.every(
      (check) => typeof check === 'string' && check.trim().length > 0,
    )) {
    return false;
  }
  const suggestionIds = value.suggestions.map(({ id }) => id);
  if (new Set(suggestionIds).size !== suggestionIds.length) return false;
  return true;
}

export function decideReviewEvent(gates) {
  if (!validReviewGateEnvelope(gates)) {
    throw new Error('Review is incomplete; update the marker only');
  }
  const {
    reviewersComplete,
    reproductionComplete,
    materialUncertainty,
    verifierVerdict,
    findings,
    failedRequiredChecks,
    headUnchanged,
  } = gates;
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
    '  review-protocol.mjs validate --kind review --angle ANGLE --input FILE',
    '  review-protocol.mjs validate --kind reproduction --expected-ids-file IDS.json --input FILE',
    '  review-protocol.mjs validate --kind verification --expected-ids-file IDS.json --input FILE',
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
    const options = readOptions(
      rest,
      new Set(['kind', 'angle', 'expected-ids-file', 'input']),
    );
    const kind = requireOption(options, 'kind');
    const input = requireOption(options, 'input');
    let validate;
    if (kind === 'review') {
      if (options['expected-ids-file'] !== undefined) throw new Error(usage());
      validate = (value) => validateReviewResult(value, requireOption(options, 'angle'));
    } else if (kind === 'reproduction') {
      if (options.angle !== undefined) throw new Error(usage());
      const expectedIdsFile = requireOption(options, 'expected-ids-file');
      const expectedIds = validateExpectedReproductionIds(parseJsonInput(
        await readFile(expectedIdsFile, 'utf8'),
        expectedIdsFile,
      ));
      validate = (value) => validateReproductionResult(value, expectedIds);
    } else if (kind === 'verification') {
      if (options.angle !== undefined) throw new Error(usage());
      const expectedIdsFile = requireOption(options, 'expected-ids-file');
      const expectedIds = validateExpectedVerificationIds(parseJsonInput(
        await readFile(expectedIdsFile, 'utf8'),
        expectedIdsFile,
      ));
      validate = (value) => validateVerificationResult(value, expectedIds);
    } else {
      throw new Error(usage());
    }
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
