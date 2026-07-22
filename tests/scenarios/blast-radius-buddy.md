# Blast Radius Buddy scenario

## No-skill baseline

The control produced strong domain-specific review logic and test ideas, but did not:

- isolate three fresh reviewer contexts;
- use a coding-agent reviewer different from the authoring agent;
- create and update one GitHub marker comment;
- automatically reject findings that fail a strict evidence gate; or
- isolate reviewers from untrusted repository configuration; or
- gate one native review event on structured validation and an unchanged head SHA.

## Revised no-skill baseline

### `clean-pr.md`

```text
Review event: `APPROVE`

GitHub output:

> Cache behavior matches the requirement: decisions expire after five minutes, and the key includes both `user.id` and `resource.id`, so a denial for one resource does not affect another. No blocking findings.

Inline comments: none. No GitHub writes performed.
```

### `medium-regression.md`

```text
Review event: `REQUEST_CHANGES`

GitHub review comment on the changed return line:

> This makes `pageCount(20, 10)` return `1`, so the second full page becomes unreachable. `Math.ceil(total / pageSize)` already returns the correct one-indexed page count for exact multiples. Please remove the subtraction.

No files or GitHub state changed.
```

### `stale-head.md`

```text
Abort the review as stale.

- Reviewed head: `1111111111111111111111111111111111111111`
- Current head before submission: `2222222222222222222222222222222222222222`
- Review event: `STALE_HEAD` / skipped; rerun review on the new head.
- GitHub output: none. Do not submit `APPROVE`, `COMMENT`, or `REQUEST_CHANGES`, since the no-findings result applies only to the old commit.
```

| fixture | observed gap | revised-skill assertion |
| --- | --- | --- |
| `clean-pr.md` | The control jumps straight to `Review event: APPROVE` after one unstructured assessment. It records no three-angle isolation, structured validation, fresh-eyes pass, or marker lifecycle, so the approval gates are unproven. | Run exactly three fresh isolated angles, reject any naming bait, complete structured validation and fresh-eyes verification, recheck the head SHA, update one marker through completion, and choose `APPROVE` only after every gate passes. |
| `medium-regression.md` | The control finds the defect but chooses `Review event: REQUEST_CHANGES` and records neither isolated angles nor validation. | Report the pagination defect exactly once, reject the deliberate formatting bait, validate or narrow the finding, update one marker through completion, and submit `COMMENT`, never `REQUEST_CHANGES`. |
| `stale-head.md` | The control correctly says `Abort the review as stale` but its `GitHub output: none` leaves no marker lifecycle or terminal stale status. | Replace the working marker with the exact old/new-SHA stale message, leave no working marker behind, and submit no native review. |

## Forward test: 2026-07-22

Three blind agents received only one fixture each, the worktree skill path, and the mocked-GitHub constraint. The clean and medium fixtures ran first as slots allowed; stale ran after one finished. Every `gh` response and GitHub operation was represented by a local artifact. No live write, code edit, branch mutation, commit, or push occurred.

### Observed failures and minimal corrections

1. The first clean run used the invalid shorthand `feature-truth` and two angle calls exhausted:

   > Expected exactly one final fenced brb-review JSON block

   The smallest correction lists all three canonical angle slugs and tells first-pass reviewers to return one fenced block with no prose before or after it. A contract test captured both requirements before the recipe changed.

2. The next clean run completed all three first passes, then exhausted:

   > Expected exactly one final fenced brb-reproduction JSON block

   The same exact-only wording was added to reproduction and fresh-eyes recipes and protocol contracts. A contract test first failed for the missing reproduction and verification wording, then passed.

3. The original clean fixture was not genuinely clean. All three fresh angles independently found the ambiguous key `${user.id}:${resource.id}`; system blast radius also reported:

   > Unbounded cache growth leads to memory exhaustion in long-running processes

   Suppressing those findings to force `APPROVE` would make the oracle dishonest. The fixture now uses `JSON.stringify([user.id, resource.id])`, states that IDs are arbitrary strings, and supplies the bounded TTL/LRU cache contract. The short variable `k` remains deliberate naming bait. A fixture contract test failed before this correction and passed after it.

No other skill behavior changed.

### Corrected-run score

| assertion | clean | medium regression | stale head |
| --- | --- | --- | --- |
| Three fresh canonical angles | Pass: three isolated, tool-less Claude outputs validated | Pass: three isolated, tool-less Claude outputs validated | Pass: three clean angle envelopes supplied by the fixture and protocol-validated |
| Reject bait | Pass: no finding or comment about short name `k` | Pass: no finding or comment about parentheses or spacing | Not applicable |
| Finding handling | Pass: no actionable finding survived the stated cache and ID contracts | Pass: two angles were deduplicated to exactly one `BRB001`; direct changed-line evidence validated it, so reproduction selection was empty | Pass: no findings |
| Fresh eyes | Pass: `clean`, no challenges | Pass: `uphold`, no challenges | Pass: `clean`, no challenges |
| Head recheck | Pass: captured and rechecked full SHA matched | Pass: captured and rechecked full SHA matched | Pass: changed from `1111111` to `2222222` and blocked submission |
| Native event | Pass: `APPROVE`, zero inline comments | Pass: `COMMENT`, one pagination comment | Pass: no native review body, comments, or event |
| Marker terminal state | Pass: exact completed marker | Pass: exact completed marker | Pass: exact stale-head marker only |

Both submitted mock reviews start exactly with:

```text
🧨 The shake is over; here's what held and what came loose.
```

All three runs start with the exact playful working marker. The clean and medium runs replace it with the completed marker; the stale run replaces it with:

```text
Blast Radius Buddy stopped because the PR moved from `1111111` to `2222222`. Run it again for the new revision.

<!-- blast-radius-buddy -->
```

No run left a working marker behind. The stale run intentionally has no final review opening because no native review artifact was prepared or submitted.

## Forward test: optional approval suggestion, 2026-07-22

The neutral `approve-with-suggestion.md` fixture was created before any expected answer was shown. Every reviewer received only the raw export contract, diff, its single rubric, and the protocol envelope. GitHub state was fixed to mock PR `example/telemetry#27`, with captured and pre-submit head `4444444444444444444444444444444444444444`, no prior feedback, and passing required checks.

### No-revision baseline at `7170ffae179e36ce3fc8898e55035019b3d17b67`

Three fresh isolated, tool-less first-pass contexts returned these exact validated artifacts:

```json
{"angle":"security-and-abuse","output":{"status":"complete","findings":[]}}
{"angle":"system-blast-radius","output":{"status":"complete","findings":[]}}
{"angle":"feature-truth-and-adjacent-regressions","output":{"status":"complete","findings":[]}}
```

The separate fresh-eyes context returned exactly:

```json
{"verdict":"clean","challenges":[]}
```

The historical normalized report and gates had no suggestion field. Historical `github-review.mjs prepare` and the fake submit executor produced:

```json
{
  "capturedHeadSha": "4444444444444444444444444444444444444444",
  "preSubmitHeadSha": "4444444444444444444444444444444444444444",
  "event": "APPROVE",
  "comments": [],
  "operationOrder": ["mock-head-recheck", "mock-native-review-post"]
}
```

The exact rendered body was:

```text
🧨 The shake is over; here's what held and what came loose.

**Verdict:** Approve
**Reviewed head:** `4444444444444444444444444444444444444444`

## Validation

- No finding met a reproduction predicate; all three isolated reviewers completed with no findings.

## Coverage

- Security and abuse: No consequential security or abuse defect found.
- System blast radius: No consequential system blast-radius defect found.
- Feature truth and adjacent regressions: The required completion event contract is satisfied and telemetry failure is contained.

<!-- blast-radius-buddy-review:{"headSha":"4444444444444444444444444444444444444444","findings":[]} -->
```

Observed gap: all four agents kept the correct change clean, but `7170ffa` had nowhere to carry the available `exportType` improvement. The native approval therefore omitted it and emitted `comments: []`.

### Revised run at `891a820f3608546cb424725e4ec6c0d60af374d0`

After the fixture-only correction below, three new isolated, tool-less first-pass contexts returned these exact validated artifacts:

```json
{"status":"complete","findings":[],"suggestions":[{"angle":"security-and-abuse","confidence":"high","title":"Include exportType dimension to prevent cross-type metric conflation","improvement":"Add `exportType: job.type` to the telemetry payload so that per-type duration and row-count metrics cannot be conflated across csv and xlsx exports, which have different performance profiles and abuse thresholds.","benefit":"Operators can set per-type alerting thresholds (e.g., abnormally large xlsx exports) and detect abuse patterns that would be invisible in an aggregated metric.","evidence":[{"path":"src/exports/complete-export.ts","line":48,"behavior":"The telemetry event is emitted without the exportType dimension despite job.type being in scope and the schema explicitly accepting it, so all export types are aggregated into one metric stream."}],"suggestedChange":"Add `exportType: job.type` to the object passed to `telemetry.track`.","mechanical":true,"priorFeedback":null,"reporters":["security-and-abuse"]}]}
{"status":"complete","findings":[],"suggestions":[{"angle":"system-blast-radius","confidence":"high","title":"Include available exportType dimension in telemetry event","improvement":"Add `exportType: job.type` to the track payload to populate the optional schema dimension that is already in scope.","benefit":"Enables filtering and alerting on export type without a backfill; the value is already validated by the schema's finite enum so there is no risk of cardinality explosion.","evidence":[{"path":"src/exports/complete-export.ts","line":48,"behavior":"The track call omits `exportType` even though `job.type` (csv | xlsx) is in scope and the telemetry schema accepts it as an optional finite dimension."}],"suggestedChange":"telemetry.track(\"export.completed\", {\n  jobId: job.id,\n  durationMs: ms,\n  rowCount: rows.length,\n  exportType: job.type\n});","mechanical":true,"priorFeedback":null,"reporters":["system-blast-radius"]}]}
{"status":"complete","findings":[],"suggestions":[{"angle":"feature-truth-and-adjacent-regressions","confidence":"high","title":"Include available exportType dimension in telemetry event","improvement":"Add `exportType: job.type` to the `telemetry.track` payload to populate the optional schema dimension with the value already in scope.","benefit":"Enables per-format analysis (csv vs xlsx) in telemetry dashboards without a follow-up change; the schema already validates the field and the value is on-hand.","evidence":[{"path":"src/exports/complete-export.ts","line":48,"behavior":"The track call omits `exportType` even though `job.type` holds the correct value and the telemetry schema accepts it as a finite optional dimension."}],"suggestedChange":"Add `exportType: job.type` to the properties object passed to `telemetry.track`.","mechanical":true,"priorFeedback":null,"reporters":["feature-truth-and-adjacent-regressions"]}]}
```

All three were semantically deduplicated to this exact host-owned report entry, anchored to the changed `rowCount` line so the replacement is mechanically valid:

```json
{
  "id": "BRS001",
  "confidence": "high",
  "title": "Include the export type in completion telemetry",
  "improvement": "Add the already available `job.type` as the optional `exportType` event dimension.",
  "benefit": "Export-duration and row-count dashboards can be segmented by CSV versus XLSX without changing export behavior.",
  "evidence": [
    {
      "path": "src/exports/complete-export.ts",
      "line": 49,
      "behavior": "The new completion-event payload ends with `rowCount` while the schema-supported `job.type` value is already in scope."
    }
  ],
  "suggestedChange": "      rowCount: rows.length,\n      exportType: job.type",
  "mechanical": true
}
```

The separate fresh-eyes context was bound to `EXPECTED-SUGGESTION-IDS.json = ["BRS001"]` and returned exactly:

```json
{"verdict":"clean","challenges":[{"target":"BRS001","evidence":"Three independent reviewers converged on the same suggestion; job.type is asserted in-scope at the changed line; adding an optional property to a telemetry payload is additive and non-behavioral; schema validity without the field is stated, making it a safe optional enhancement","reason":"keep - evidence is consistent across reviewers, benefit (dashboard segmentation) is concrete, change is mechanical and risk-free","reportEffect":"none"}]}
```

The host then wrote this exact source-bound `VERIFICATION.json`, pairing that result with the normalized suggestion snapshot fresh eyes reviewed:

```json
{
  "result": {
    "verdict": "clean",
    "challenges": [
      {
        "target": "BRS001",
        "evidence": "Three independent reviewers converged on the same suggestion; job.type is asserted in-scope at the changed line; adding an optional property to a telemetry payload is additive and non-behavioral; schema validity without the field is stated, making it a safe optional enhancement",
        "reason": "keep - evidence is consistent across reviewers, benefit (dashboard segmentation) is concrete, change is mechanical and risk-free",
        "reportEffect": "none"
      }
    ]
  },
  "suggestions": [
    {
      "id": "BRS001",
      "confidence": "high",
      "title": "Include the export type in completion telemetry",
      "improvement": "Add the already available `job.type` as the optional `exportType` event dimension.",
      "benefit": "Export-duration and row-count dashboards can be segmented by CSV versus XLSX without changing export behavior.",
      "evidence": [
        {
          "path": "src/exports/complete-export.ts",
          "line": 49,
          "behavior": "The new completion-event payload ends with `rowCount` while the schema-supported `job.type` value is already in scope."
        }
      ],
      "suggestedChange": "      rowCount: rows.length,\n      exportType: job.type",
      "mechanical": true
    }
  ],
  "promotions": []
}
```

The exact gates were:

```json
{
  "reviewersComplete": true,
  "reproductionComplete": true,
  "materialUncertainty": false,
  "verifierVerdict": "clean",
  "findings": [],
  "suggestions": [{ "id": "BRS001" }],
  "failedRequiredChecks": [],
  "headUnchanged": true
}
```

Revised `github-review.mjs prepare` and the fake submit executor produced the exact opening and suggestion comment below with native event `APPROVE`:

```text
🧨 The shake is over; here's what held and what came loose.
```

```json
{
  "commit_id": "4444444444444444444444444444444444444444",
  "event": "APPROVE",
  "comments": [
    {
      "path": "src/exports/complete-export.ts",
      "line": 49,
      "side": "RIGHT",
      "body": "**BRS001 · Non-blocking suggestion · Include the export type in completion telemetry**\n\nImprovement: Add the already available `job.type` as the optional `exportType` event dimension.\n\nBenefit: Export-duration and row-count dashboards can be segmented by CSV versus XLSX without changing export behavior.\n\nEvidence: `src/exports/complete-export.ts:49` — The new completion-event payload ends with `rowCount` while the schema-supported `job.type` value is already in scope.\n\n```suggestion\n      rowCount: rows.length,\n      exportType: job.type\n```\n\n<!-- blast-radius-buddy-suggestion:BRS001:BRBK1_30a2351c63565556a87c89e139906ddee1be99f117ed40e30c72202f7cf519ce -->"
    }
  ]
}
```

No reviewer mentioned the short `ms` name, quote style, missing trailing comma, or formatting. No finding survived. The fake executor logged only `mock-head-recheck` then `mock-native-review-post`; it launched no `gh` subprocess and made no network or GitHub call. The marker lifecycle existed only as local mock artifacts and ended with:

```text
Review complete for `4444444`: https://github.invalid/example/telemetry/pull/27#pullrequestreview-9002

<!-- blast-radius-buddy -->
```

The worktree branch and head remained `feat/non-blocking-approvals` at `891a820f3608546cb424725e4ec6c0d60af374d0` throughout both forward runs.

### Observed correction

The first revised deterministic preparation failed with the exact error:

```text
report.suggestions[0] must cite a PR-relative new-side changed line
```

The suggestion cited a real added line, but the neutral fixture declared `@@ -42,6 +42,18 @@` for a hunk that actually contains 3 old and 15 new lines. `collectChangedLines` correctly rejected the malformed hunk. A fixture contract test failed first, then the fixture header changed to `@@ -42,3 +42,15 @@`; the neutral heading also stopped naming the expected outcome. No skill file changed. Both baseline and revised agent sets were rerun from new isolated contexts after this correction.
