# Finding and suggestion validation

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

The host writes the selected IDs, in selection order, to `EXPECTED_IDS.json` as a JSON array such as `["BRB001","BRB002"]`. Run one host-selected diagnostic and bind classification to that host-owned set with the deterministic checkout wrapper documented in `reviewer-prompts.md`:

```bash
node skills/blast-radius-buddy/scripts/reproduction-checkout.mjs classify \
  --repository REPOSITORY_PATH \
  --head-sha FULL_HEAD_SHA \
  --prompt-file REPRODUCTION-PROMPT.md \
  --expected-ids-file EXPECTED_IDS.json \
  --evidence-output DIAGNOSTIC-EVIDENCE.json \
  --output REPRODUCTION.json \
  -- COMMAND [ARG...]
```

`--expected-ids-file` must contain a non-empty list of unique run-local IDs. The helper validates it before creating the checkout. It captures the diagnostic's command, arguments, exit code, stdout, and stderr, confirms the checkout stayed clean, and passes that evidence as untrusted data to a fresh tool-less classifier. The validator rejects an empty model result, duplicate classifications, any omission, and any extra ID, then emits results in host selection order. Never trust model-returned IDs to define the selected set.

Return only one fenced `brb-reproduction` block, with no prose before or after it, containing this exact envelope:

```brb-reproduction
{"results":[{"id":"BRB001","verdict":"confirmed | narrowed | downgraded | unclear | refuted","severity":"critical | high | medium","evidence":"specific fact or command output","reason":"short classification reason","reportEffect":"actionable | deferred | drop"}]}
```

## Fresh-eyes verification

Attack only:

- false positives and unsupported causality;
- incorrect scope or severity;
- suggestions whose evidence or benefit does not justify a high-confidence optional improvement;
- mistaken prior-feedback status or duplicate treatment;
- unsafe, non-mechanical, or over-broad suggested changes;
- an unjustified `APPROVE` event or a clean verdict contradicted by evidence.

Do not start a fourth broad review.

Enter fresh-eyes verification with at most three synthesized suggestions, each carrying its stable `BRS001`-style ID. Verification requires `--expected-ids-file` containing the complete host-selected BRS ID array. The array may be empty; otherwise every ID must be a unique valid BRS ID. The validator requires one BRS challenge per expected ID and rejects any omission, extra ID, or duplicate classification while still allowing relevant `BRB` and `approval` challenges.

Classify every suggestion as `keep`, `promote`, or `drop`:

- `keep`: the change remains a concrete, evidence-backed improvement and the pull request is correct without it;
- `promote`: the evidence shows a defect that should be fixed; turn it into a finding and recompute the report and proposed event;
- `drop`: remove a weak, generic, duplicative, or uncertain suggestion.

Encode `keep` as a `none` challenge effect on its `BRS` ID, `promote` as `actionable`, and `drop` as `drop`. An uncertain suggestion is dropped, never deferred. Preserve the IDs of surviving suggestions.

Classify the synthesis as:

- `uphold`: retain the finding-bearing synthesis and proposed `COMMENT`;
- `modify`: apply the specific challenges and recompute the report;
- `defer`: move material unresolved uncertainty to deferred and use `COMMENT`;
- `drop`: remove the challenged findings and recompute the event;
- `clean`: uphold a correct synthesis after applying any optional-suggestion drops, then evaluate the approval gates.

Apply each challenge's `reportEffect`: for a `BRB` target, `actionable` keeps or changes a finding, `deferred` exposes material uncertainty, `drop` removes it, and `none` changes nothing. For a `BRS` target, `none` keeps the suggestion, `actionable` promotes it to a finding and requires the event to be recomputed, and `drop` removes it; `deferred` is invalid. Return only one fenced `brb-verification` block, with no prose before or after it, containing this exact envelope:

The validator enforces these verdict semantics:

- `uphold`: no report-changing challenge; use an empty challenge list or only `none` effects.
- `modify`: at least one challenge has an `actionable`, `deferred`, or `drop` effect.
- `defer`: at least one challenge has a `deferred` effect.
- `drop`: at least one challenge has a `drop` effect.
- `clean`: every expected BRS challenge uses `none` or `drop`. `clean` with a BRS `drop` removes the weak suggestion, recomputes the report, and may proceed to `APPROVE` when every other gate passes. `clean` rejects BRS `actionable`, every `deferred` effect, and report-changing `BRB` or `approval` effects.

```brb-verification
{"verdict":"clean","challenges":[{"target":"BRS001","evidence":"specific fact","reason":"keep or drop reason","reportEffect":"none | drop"}]}
```
