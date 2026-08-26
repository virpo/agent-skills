# BRB Linked Finding Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a compact severity/title list in every actionable BRB root review and enrich inline items with their exact GitHub discussion links after submission.

**Architecture:** Keep deterministic rendering, marker parsing, GitHub comment lookup, and review-body update inside `github-review.mjs`. The initial POST contains a useful unlinked list; after GitHub assigns discussion URLs, BRB maps them through existing stable finding markers and updates the same review. A post-creation enrichment failure returns success with a sanitized warning so automation never duplicates an already-created native review.

**Tech Stack:** Node.js ESM, GitHub CLI REST calls, `node:test`, deterministic Markdown and hidden BRB markers.

## Global Constraints

- Preserve one native review and one final marker per trigger.
- Never invent an inline link or weaken changed-line anchor validation.
- Reauthorize and recheck the exact head immediately before the follow-up review-body write.
- Keep approvals and suggestion-only reviews concise and unchanged.
- Do not add dependencies, push, or alter unrelated user files.

---

### Task 1: Render the compact finding index

**Files:**
- Modify: `skills/blast-radius-buddy/scripts/github-review.mjs`
- Test: `tests/github-review.test.mjs`

**Interfaces:**
- Consumes: normalized findings with `id`, `severity`, and `title`; optional `Map<string, string>` discussion URLs; the existing body-only finding partition.
- Produces: `buildReviewBodyFromNormalized(normalized, { bodyFindings, findingLinks, triggerId, ... })`, whose actionable opening always contains every finding in report order.

- [ ] **Step 1: Write failing renderer tests**

Add tests asserting the prepared actionable body contains:

```js
assert.match(prepared.body, /3 things need another pass\./);
assert.match(prepared.body, /- \*\*Medium\*\* — Update review hides the workflow being overwritten/);
assert.doesNotMatch(prepared.body, /details are inline/);
```

Add a direct linked-rendering test through a small exported helper or optional renderer input:

```js
assert.match(body, /\*\*High\*\* — \[The final full page is skipped\]\(https:\/\/github\.com\/acme\/widget\/pull\/19#discussion_r123\)/);
```

Also assert a body-only finding is rendered as:

```md
- **High** — The final full page is skipped _(details below)_
```

and that approval and suggestion-only fixtures retain their current conclusions.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/github-review.test.mjs
```

Expected: FAIL because actionable root bodies still say `details are inline` and no linked-summary renderer exists.

- [ ] **Step 3: Implement the minimal deterministic renderer**

Add helpers equivalent to:

```js
function severityLabel(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function formatFindingIndexItem(finding, { url, bodyOnly }) {
  const severity = severityLabel(finding.severity);
  const title = visibleText(finding.title);
  const subject = url === undefined ? title : `[${title}](${url})`;
  return `- **${severity}** — ${subject}${bodyOnly ? ' _(details below)_' : ''}`;
}
```

Render the index immediately after the opening conclusion. Validate every supplied URL as an exact GitHub discussion URL before interpolation. Use finding IDs, not titles or ordinals, as the map keys. Preserve report order, full body-only details, the audit footer, and hidden review metadata.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/github-review.test.mjs
```

Expected: all `github-review` tests pass.

- [ ] **Step 5: Commit the renderer**

```bash
git add skills/blast-radius-buddy/scripts/github-review.mjs tests/github-review.test.mjs
git commit -m "feat: summarize BRB findings in review bodies"
```

### Task 2: Enrich the submitted review with exact discussion links

**Files:**
- Modify: `skills/blast-radius-buddy/scripts/github-review.mjs`
- Modify: `skills/blast-radius-buddy/scripts/review-coordinator.mjs`
- Modify: `skills/blast-radius-buddy/SKILL.md`
- Test: `tests/github-review.test.mjs`
- Test: `tests/review-coordinator.test.mjs`

**Interfaces:**
- Consumes: the parsed `reviewId`, validated inline comment bodies, GitHub review-comment responses containing `body`, `html_url`, and `pull_request_review_id`, and the existing `authorizeWrite` callback.
- Produces: one `PUT repos/{repo}/pulls/{number}/reviews/{reviewId}` update with a linked root body; on post-creation failure, the original successful review result plus `summaryWarning: 'Native review finding links could not be added'`.

- [ ] **Step 1: Write failing submission and recovery tests**

Extend the successful COMMENT submission fixture to expect this sequence:

```js
[
  ['gh', ['pr', 'view', '19', '--repo', 'acme/widget', '--json', 'headRefOid']],
  ['gh', ['api', '--method', 'POST', 'repos/acme/widget/pulls/19/reviews', '--input', payloadFile]],
  ['gh', ['api', 'repos/acme/widget/pulls/19/reviews/9/comments', '--paginate', '--slurp']],
  ['gh', ['pr', 'view', '19', '--repo', 'acme/widget', '--json', 'headRefOid']],
  ['gh', ['api', '--method', 'PUT', 'repos/acme/widget/pulls/19/reviews/9', '--input', updateFile]],
]
```

Return a review comment whose body ends in the existing BRB finding marker and whose `html_url` is `https://github.com/acme/widget/pull/19#discussion_r123`. Assert the PUT body contains the linked index and unchanged hidden metadata.

Add tests for foreign review IDs, non-GitHub URLs, missing markers, duplicate finding markers, missing expected inline findings, aborted authorization, and a failed GET/PUT after POST. Post-creation failures must resolve with:

```js
{
  reviewId: 9,
  reviewUrl: REVIEW_URL,
  summaryWarning: 'Native review finding links could not be added',
}
```

and must never perform a second review POST. Add a coordinator test asserting `summaryWarning` creates one content-free `review-summary-warning` lifecycle record while the run still completes.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test tests/github-review.test.mjs tests/review-coordinator.test.mjs
```

Expected: FAIL because submission currently returns immediately after POST and the coordinator has no enrichment warning event.

- [ ] **Step 3: Implement marker-bound lookup and PUT enrichment**

Implement strict helpers equivalent to:

```js
function findingIdFromComment(body) {
  return body.match(/<!-- blast-radius-buddy-finding:(BRB\d+):BRBK1_[0-9a-f]{64} -->$/)?.[1];
}

function discussionLinksForReview(rawPages, { reviewId, expectedIds, repo, number }) {
  // Flatten paginated pages, require one exact marker and one scoped GitHub
  // html_url for every expected inline finding, and reject duplicates.
}
```

After parsing the successful POST response:

1. Skip enrichment when there are no inline finding comments.
2. GET only `reviews/{reviewId}/comments` with pagination and the caller's abort signal.
3. Build the ID-to-URL map from exact stable markers.
4. Re-render from the normalized source artifacts with those links.
5. Recheck the exact head.
6. Call `authorizeWrite()` and honor abort.
7. PUT a temporary JSON payload containing only `{ body: linkedBody }` to the official update-review endpoint.

Wrap only steps after the successful POST. On failure, return the parsed review plus the sanitized warning instead of throwing. Always clean both temporary payload files.

- [ ] **Step 4: Make the warning observable and document the contract**

Pass `summaryWarning` through the GitHub adapter. After `github.submit`, log only:

```js
{
  event: 'review-summary-warning',
  pr: trigger.number,
  triggerId: trigger.triggerId,
  reason: submission.summaryWarning,
}
```

Continue to the final marker and successful trigger state so the scheduler cannot create a duplicate review. Update BRB workflow step 8 to state that actionable root reviews include the compact finding index and are updated with exact inline discussion links after submission.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node --test tests/github-review.test.mjs tests/review-coordinator.test.mjs tests/blast-radius-buddy-contract.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm run check
```

Expected: all tests pass with zero failures.

- [ ] **Step 7: Commit the enrichment**

```bash
git add skills/blast-radius-buddy/SKILL.md skills/blast-radius-buddy/scripts/github-review.mjs skills/blast-radius-buddy/scripts/review-coordinator.mjs tests/github-review.test.mjs tests/review-coordinator.test.mjs
git commit -m "feat: link BRB finding summaries"
```

