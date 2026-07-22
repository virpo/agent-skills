# Review angles and first-pass protocol

Give each fresh first-pass reviewer only one rubric. Do not share another reviewer's output before synthesis.

Bind validation to the assigned angle. Pass the canonical angle slug with `--angle` to `reviewer-runner.mjs run-claude` or `review-protocol.mjs validate`. Each first-pass finding's `angle` must equal that assigned angle, and `reporters` must contain exactly one reporter matching the assigned angle. The validator rejects mismatches and normalizes the reporter to that canonical slug.

Use these exact canonical slugs; never shorten them:

- `security-and-abuse`
- `system-blast-radius`
- `feature-truth-and-adjacent-regressions`

Only the host synthesis may combine agreement. A synthesized finding may retain multiple reporters only when every reporter is a unique approved angle slug. Reviewer-supplied duplicate or unknown reporters are invalid.

## Security and abuse

Trace attacker-controlled input and trust boundaries through:

- authentication, authorization, tenancy, ownership, and confused-deputy paths;
- injection, unsafe parsing or deserialization, path handling, and command execution;
- secrets, personal data, logs, caches, errors, and unintended disclosure;
- privilege escalation, replay, dependency trust, supply-chain exposure, and practical abuse at scale.

Require a reachable attack or misuse path and a concrete consequence. Omit generic hardening advice.

## System blast radius

Trace failures beyond the immediate call site through:

- data loss, corruption, partial writes, migrations, rollback, and compatibility;
- concurrency, retries, duplicate delivery, ordering, and shared mutable state;
- startup, deployment, dependency failure, resource exhaustion, and performance cliffs;
- shared paths and observability gaps that can hide a material outage.

Require a plausible trigger and a consequential affected surface. Omit local inefficiency without meaningful impact.

## Feature truth and adjacent regressions

Trace the stated user contract and nearby behavior through:

- domain invariants and every changed state transition;
- edge cases, retries, idempotency, and backwards compatibility;
- callers and sibling features sharing the changed path;
- realistic inputs that distinguish the requirement from the implementation.

Require a demonstrated mismatch between intended and actual behavior. Omit product preference.

## Severity and evidence gate

Use only `critical`, `high`, or `medium`:

- `critical`: reachable catastrophic security, data-integrity, or availability failure requiring immediate intervention;
- `high`: reachable consequential user, data, security, availability, deployment, or compatibility failure;
- `medium`: observable incorrect behavior, a security or reliability weakness, a significant user-facing regression, or a broken contract in code changed or directly affected by the PR.

Use `high` or `medium` confidence. Support every finding with a concrete mechanism, reachability, impact, and repository-relative evidence. Use a new-side line when available. Set `suggestedChange` and `mechanical` according to the inline-suggestion eligibility in `github-report.md`. Set proof-risk booleans explicitly. The host assigns stable IDs after synthesis.

## Output contract

Return only one fenced `brb-review` block, with no prose before or after it. For a completed review, including one with no findings, use this exact envelope and exact fields. Substitute the assigned canonical angle slug for both `<assigned-angle>` values:

```brb-review
{
  "status": "complete",
  "findings": [
    {
      "angle": "<assigned-angle>",
      "severity": "critical | high | medium",
      "confidence": "high | medium",
      "title": "concise observable failure",
      "what": "what the changed code does",
      "why": "mechanism and concrete result",
      "reachability": "input, caller, state, or deployment path",
      "impact": "user, data, security, availability, or compatibility consequence",
      "evidence": [{ "path": "repo/relative", "line": 1, "behavior": "supporting fact" }],
      "suggestedFix": "smallest credible behavior change",
      "suggestedChange": null,
      "mechanical": false,
      "priorFeedback": null,
      "reporters": ["<assigned-angle>"],
      "needsRuntimeProof": false,
      "securitySensitive": false,
      "deletionSensitive": false,
      "scopeUncertain": false
    }
  ]
}
```

When exact missing code, contract, configuration, or test context prevents a complete review, use:

```brb-review
{"status":"needs-context","missingContext":["exact missing item"]}
```
