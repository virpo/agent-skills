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

## Native review

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
