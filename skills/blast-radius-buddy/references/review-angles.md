# High-impact review angles and finding gate

Run these as exactly three isolated reviewer contexts. Give each the same bounded packet, its single rubric, and the finding contract. Do not share another angle's output. Synthesis happens only after all three return.

## 1. Security and abuse

Trace attacker-controlled and cross-trust-boundary paths:

- authentication, authorization, tenancy, ownership, and confused-deputy boundaries;
- injection, unsafe parsing or deserialization, path and command handling;
- secrets, personal data, logs, caches, errors, and unintended disclosure;
- privilege escalation, replay, abuse at scale, and dependency or supply-chain exposure.

Require an executable attack or misuse path. A generic hardening suggestion is not a finding.

## 2. System blast radius

Trace how the change can fail beyond its immediate call site:

- data loss, corruption, partial writes, migrations, rollback, and compatibility;
- concurrency, retries, duplicate delivery, ordering, and shared mutable state;
- startup, deploy, dependency failure, resource exhaustion, and performance cliffs;
- shared-path regressions and observability gaps that can hide a material outage.

Require a plausible trigger and a consequential affected surface. Local inefficiency without meaningful impact is not a finding.

## 3. Feature truth and adjacent regressions

Trace the user contract and nearby behavior end to end:

- domain invariants and every changed state transition;
- edge cases, retries, idempotency, and backwards compatibility;
- callers and sibling features sharing the changed path;
- whether the implementation actually satisfies the stated requirement under realistic inputs.

Require a demonstrated mismatch between intended and actual behavior. Product preference is not a finding.

## Finding contract

Return `NO_FINDING` when nothing passes. Otherwise return one or more records with every field:

```yaml
angle: security-and-abuse | system-blast-radius | feature-truth-and-adjacent-regressions
title: concise failure, not a suggestion
severity: blocker | high
confidence: high | medium
failure_path: concrete trigger-to-failure or attack sequence
impact: meaningful user, data, security, availability, or deployment consequence
evidence:
  path: repository-relative file
  lines: exact changed or surrounding lines
  behavior: what those lines cause
proof:
  kind: regression-test | reproducible-check
  command: exact deterministic command
  expected_failure: observable pre-fix result
smallest_fix: narrow credible repair
```

Reject a record when any field is absent, its path cannot execute, its impact is not meaningful, its evidence does not support the claim, or its proof is not reproducible. Reproduce accepted claims before repair when authorization permits. Deduplicate by failure path and root cause, preserving the strongest evidence.

A reproducible check may survive triage. It never substitutes for a durable automated regression test during an authorized repair. Before production code changes, add and run a focused regression test that fails for the accepted path. If a durable test cannot be added, leave the code unchanged and report the gap.
