# GitHub report contract

Use `scripts/review-comment.mjs` for the one marker and `scripts/github-review.mjs` for the one native review. Write bodies to local files before passing them to helpers.

## Marker lifecycle

Start with exactly:

```markdown
🧨 Blast Radius Buddy is giving `<short-sha>` a careful shake; I'll keep this comment updated as the review moves.

- [ ] Three-angle review
- [ ] Finding validation
- [ ] Fresh-eyes verification

<!-- blast-radius-buddy -->
```

Check each item only after that stage completes. Update the authenticated user's existing marker after each stage; never create separate progress comments. After native review submission, replace the marker with exactly:

```markdown
Review complete for `<short-sha>`: <review-url>

<!-- blast-radius-buddy -->
```

## Failure and stale state

Any model, authentication, permission, protocol, reproduction, verification, or submission failure immediately replaces the working marker with this exact body:

```markdown
Blast Radius Buddy could not complete the review of `<short-sha>`: <exact reason>.

<!-- blast-radius-buddy -->
```

A changed head replaces it with this exact body:

```markdown
Blast Radius Buddy stopped because the PR moved from `<old-sha>` to `<new-sha>`. Run it again for the new revision.

<!-- blast-radius-buddy -->
```

Neither case submits a native review or claims approval. Never leave the marker in a working state.

## Normalized REPORT.json

`prepare` consumes the exact renderer-facing shape below. Every field shown is required, including empty arrays; do not add fields.

```json
{
  "verdict": "Actionable findings",
  "headSha": "0123456789abcdef0123456789abcdef01234567",
  "findings": [
    {
      "id": "BRB001",
      "severity": "high",
      "confidence": "high",
      "title": "Concise observable failure",
      "what": "What the changed code does.",
      "why": "Mechanism and concrete result.",
      "impact": "User, data, security, availability, or compatibility consequence.",
      "evidence": [
        {
          "path": "src/feature.ts",
          "line": 42,
          "behavior": "Supporting fact on this positive new-side line."
        }
      ],
      "suggestedFix": "Smallest credible behavior change.",
      "suggestedChange": null,
      "mechanical": false
    }
  ],
  "priorFeedback": [
    {
      "id": "BRB099",
      "status": "fixed",
      "summary": "Earlier feedback no longer applies.",
      "path": "src/old-feature.ts",
      "line": 17
    }
  ],
  "validation": [
    "Reproduction confirmed BRB001 and kept it actionable."
  ],
  "deferred": [
    "Material uncertainty that remains visible to the author."
  ],
  "coverage": {
    "security": "Security and abuse result.",
    "blastRadius": "System blast-radius result.",
    "featureTruth": "Feature-truth and adjacent-regressions result."
  }
}
```

Use these field rules:

- `verdict` is exactly and case-sensitively one of `Approve`, `Actionable findings`, or `Review completed with uncertainty`.
- `headSha` is the full 40-character hexadecimal commit ID captured before review.
- `findings` contains only actionable `critical`, `high`, or `medium` findings. Use `[]` for a clean result. Each finding has a unique run-local `BRB001`-style `id`; `confidence` is `high` or `medium`; the descriptive fields are non-empty strings. `prepare` derives a review-linkage fingerprint from the finding's path, title, and failure description only to join root metadata and inline comments from the same GitHub review.
- Each `evidence` entry has a repository-relative `path`, positive integer `line`, and non-empty `behavior`. Use a reliable PR-relative new-side changed line when the finding should be inline.
- `suggestedFix` is non-empty prose. `suggestedChange` is either `null` or the exact replacement text. `mechanical` is a boolean and is `true` only when the replacement meets the safe-suggestion rules below.
- `priorFeedback` entries use exactly `id`, `status`, `summary`, `path`, and `line`. `validation` and `deferred` are arrays of non-empty strings. Use empty arrays when a section has no entries.
- `coverage` always contains exactly the non-empty `security`, `blastRadius`, and `featureTruth` strings.

## Native review

Write the explicit gate state to `GATES.json` using exactly these fields:

```json
{
  "reviewersComplete": true,
  "reproductionComplete": true,
  "materialUncertainty": false,
  "verifierVerdict": "clean",
  "findings": [],
  "failedRequiredChecks": [],
  "headUnchanged": true
}
```

`findings` contains the surviving report finding IDs. `verifierVerdict` uses the exact verification verdict. Use `reproductionComplete: true` when selected reproduction completed or none was required. `headUnchanged` records the final exact-SHA check.

Prepare the review body and comments before submission:

```bash
node skills/blast-radius-buddy/scripts/github-review.mjs prepare \
  --report-file REPORT.json \
  --diff-file PR.diff \
  --gates-file GATES.json \
  --body-output BODY.md \
  --comments-output COMMENTS.json
```

`prepare` is deterministic and does not call GitHub. It strictly validates the normalized report, requires its finding IDs and verdict to agree with the gates, derives the only allowed event, writes a marker-safe report body, anchors only approved actionable findings on valid new-side diff lines, writes review-linkage fingerprints into inline comments, and keeps unanchored findings in the body. Extra, missing, malformed, or contradictory report fields stop preparation.

Submit with the original source artifacts plus the prepared body and comments:

```bash
node skills/blast-radius-buddy/scripts/github-review.mjs submit \
  --repo OWNER/REPO \
  --pr NUMBER \
  --report-file REPORT.json \
  --diff-file PR.diff \
  --gates-file GATES.json \
  --body-file BODY.md \
  --comments-file COMMENTS.json
```

`submit` recomputes and strictly validates `REPORT.json`, `PR.diff`, and `GATES.json`; derives the event again; and rejects any body or comments that differ from that preparation. It accepts no caller-supplied event, head, digest, or approval artifact. Immediately before the GitHub POST, it reads the current PR head and rejects a stale review without posting. It never accepts `REQUEST_CHANGES`.

`review-history.mjs` scopes each review-linkage fingerprint to its GitHub review ID. It joins that review's root metadata and inline thread, but preserves entries from every separate review even when their IDs or fingerprints match. Cross-run duplicate suppression is host semantic judgment over the complete ledger, including paraphrased findings; fingerprint equality is never proof of semantic equality across runs.

Start the native review with exactly:

```text
🧨 The shake is over; here's what held and what came loose.
```

Then report in this order:

1. verdict and full reviewed head SHA;
2. actionable findings;
3. prior-feedback status;
4. validation performed and its effect;
5. deferred uncertainties or important out-of-scope follow-ups;
6. three-angle coverage: security and abuse, system blast radius, feature truth and adjacent regressions.

Anchor an inline comment only to a valid PR-relative new-side changed line. Preserve a finding in the review body when no reliable anchor exists. Include a suggested-change block only when the replacement is local, mechanical, same-file, and safe to apply without judgment. Keep cross-file, architectural, generated-code, deleted-line, or uncertain fixes as prose suggestions.

## Event gates

Submit `COMMENT` when at least one actionable finding survives or a completed review has material uncertainty worth showing the author. Never submit `REQUEST_CHANGES`.

Submit `APPROVE` only when every gate passes:

- all three first-pass reviewers completed with valid output;
- selected reproduction completed or no material unresolved uncertainty remains;
- the fresh-eyes verifier returned `clean` and upheld the clean verdict;
- no new or still-present in-scope `critical`, `high`, or meaningful `medium` finding remains;
- no known failed required CI check contradicts the clean verdict;
- the current PR head exactly matches the captured SHA.

Approval means the bounded code review found no actionable defect. It does not claim every CI check passed or that the PR is merge-ready.
