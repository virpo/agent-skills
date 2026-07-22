# Blast Radius Buddy scenario

## No-skill baseline

The control produced strong domain-specific review logic and test ideas, but did not:

- isolate three fresh reviewer contexts;
- use a coding-agent reviewer different from the authoring agent;
- create and update one GitHub marker comment;
- automatically reject findings that fail a strict evidence gate; or
- isolate reviewers from untrusted repository configuration; or
- turn a reproducible check into a durable regression test before repair.

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
