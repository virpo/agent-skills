# Finding validation

Use validation as a confidence gate, never as a repair exercise.

## Select reproduction candidates

Select a synthesized finding for the single batched reproduction pass when any of these five predicates holds:

1. Only one first-pass reviewer reported a `medium` or more severe issue.
2. The claim depends on runtime, configuration, framework, generated-code, migration, or compatibility behavior not proved directly in the packet.
3. A deletion, fallback, or apparently redundant path may carry a hidden contract.
4. Severity, reachability, scope, or prior-feedback status remains uncertain.
5. The finding is security-sensitive and lacks a direct execution or abuse path.

When none of the five predicates holds, two-reviewer agreement plus direct code evidence may skip reproduction only when every evidence item supplies a repository-relative path, positive line, and supporting behavior. Use `scripts/review-protocol.mjs select-reproduction` to apply this gate.

## Reproduction verdicts

Classify every selected ID exactly once:

- `confirmed`: keep the supported claim and severity as `actionable`.
- `narrowed`: replace the claim with its proved scope and keep the surviving issue `actionable`.
- `downgraded`: lower severity to the supported tier; keep it `actionable` only if it remains a meaningful `medium`, otherwise `drop` it.
- `unclear`: remove it from actionable findings and mark it `deferred`.
- `refuted`: remove it and `drop` it from the report.

The host writes the selected IDs, in selection order, to `EXPECTED_IDS.json` as a JSON array such as `["BRB001","BRB002"]`. Bind protocol validation to that host-owned set:

```bash
node skills/blast-radius-buddy/scripts/review-protocol.mjs validate \
  --kind reproduction \
  --expected-ids-file EXPECTED_IDS.json \
  --input REPRODUCTION.txt
```

`--expected-ids-file` must contain a non-empty list of unique stable IDs. The validator rejects an empty model result, duplicate classifications, any omission, and any extra ID, then emits results in host selection order. Never trust model-returned IDs to define the selected set.

End reproduction with only one fenced `brb-reproduction` block containing this exact envelope:

```brb-reproduction
{"results":[{"id":"BRB001","verdict":"confirmed | narrowed | downgraded | unclear | refuted","severity":"critical | high | medium","evidence":"specific fact or command output","reason":"short classification reason","reportEffect":"actionable | deferred | drop"}]}
```

## Fresh-eyes verification

Attack only:

- false positives and unsupported causality;
- incorrect scope or severity;
- mistaken prior-feedback status or duplicate treatment;
- unsafe, non-mechanical, or over-broad suggested changes;
- an unjustified `APPROVE` event or a clean verdict contradicted by evidence.

Do not start a fourth broad review. Classify the synthesis as:

- `uphold`: retain the finding-bearing synthesis and proposed `COMMENT`;
- `modify`: apply the specific challenges and recompute the report;
- `defer`: move material unresolved uncertainty to deferred and use `COMMENT`;
- `drop`: remove the challenged findings and recompute the event;
- `clean`: uphold a clean synthesis for approval-gate evaluation.

Apply each challenge's `reportEffect`: `actionable` keeps or changes a finding, `deferred` exposes material uncertainty, `drop` removes it, and `none` changes nothing. End with only one fenced `brb-verification` block containing this exact envelope:

The validator enforces these verdict semantics:

- `uphold`: no report-changing challenge; use an empty challenge list or only `none` effects.
- `modify`: at least one challenge has an `actionable`, `deferred`, or `drop` effect.
- `defer`: at least one challenge has a `deferred` effect.
- `drop`: at least one challenge has a `drop` effect.
- `clean`: challenges are empty or use only `none`; never pair `clean` with `actionable`, `deferred`, or `drop`.

```brb-verification
{"verdict":"uphold | modify | defer | drop | clean","challenges":[{"target":"BRB001 | approval","evidence":"specific fact","reason":"short reason","reportEffect":"actionable | deferred | drop | none"}]}
```
