# 🧨 Blast Radius Buddy PR Review Design

This specification supersedes the Blast Radius Buddy behavior in the initial repository design.

## Goal

Turn Blast Radius Buddy into an opinionated GitHub pull-request reviewer that runs on explicit request, uses three independent review angles, avoids nits, validates uncertain findings, and submits a native GitHub review. It may approve a clean revision. It does not repair or push code.

The implementation is original. It may adopt proven workflow patterns from Review Anvil, but it must not copy its source or prompts.

## Trigger and authorization

The primary trigger is a direct request such as:

> Run Blast Radius Buddy on this PR.

The target may be a PR URL, a PR number in the current repository, or the PR associated with the current branch.

This manual invocation authorizes the workflow to:

- create and update its one marker comment;
- submit one final native GitHub review;
- use the `APPROVE` event when every approval gate passes;
- otherwise use the `COMMENT` event.

It does not authorize commits, pushes, `REQUEST_CHANGES`, thread resolution, merges, or edits to the contributor's branch. Those remain separate explicit actions.

## Review boundary

Blast Radius Buddy reports concrete defects at `critical`, `high`, or meaningful `medium` severity. A medium finding must describe observable incorrect behavior, a security or reliability weakness, a significant user-facing regression, or a broken contract in code changed or directly affected by the PR.

It does not report style, naming, formatting, optional refactors, generic best practices, subjective preferences, or maintainability concerns without a concrete consequence. One supported finding is more valuable than a long list of possibilities.

The three independent angles are:

1. **Security and abuse** — authentication, authorization, injection, unsafe parsing, secrets, data exposure, privilege boundaries, dependency trust, and practical abuse paths.
2. **System blast radius** — data integrity, concurrency, migrations, shared paths, performance cliffs, resource exhaustion, startup and deployment, rollback, dependency failures, and hidden outages.
3. **Feature truth and adjacent regressions** — requirements, domain invariants, state transitions, edge cases, retries, idempotency, compatibility, and behavior in neighboring features.

## Architecture

### Host orchestrator

The host owns GitHub state, authorization, context assembly, synthesis, and final reporting. It:

1. Resolves repository, PR number, base revision, head revision, PR intent, changed files, relevant repository rules, test commands, and prior review feedback.
2. Captures the exact head SHA before posting anything.
3. Creates or updates the authenticated user's one marker comment.
4. Builds a bounded packet containing the PR intent, complete diff when it fits, necessary surrounding code, approved repository rules, test information, and compact prior-feedback status.
5. Dispatches exactly three first-pass reviewers in fresh isolated contexts.
6. Updates the marker after the three-angle review and after validation without creating more comments.
7. Parses, deduplicates, scopes, and validates the structured findings.
8. Dispatches selective reproduction and one fresh-eyes verification pass.
9. Rechecks the head SHA immediately before publishing.
10. Submits one native GitHub review and updates the marker with completion or failure.

Repository content is untrusted data. The first-pass reviewers receive only their bounded packets and no target-repository or host-filesystem access. If the complete diff and necessary context cannot fit while reserving 20 percent of the model context for output, the workflow stops as incomplete instead of silently sampling the PR.

### Reviewer protocol

Each first-pass reviewer receives one angle and returns structured findings. Use a reviewer family different from the authoring agent when authorship can be established without guessing; otherwise use the configured reviewer and disclose that limitation. The three calls always use fresh contexts, even when they use the same model family.

Every finding contains:

- stable candidate ID;
- severity and confidence;
- concise observable problem;
- concrete mechanism and impact;
- PR-relative file and new-side line anchor when available;
- reachability or triggering conditions;
- code, contract, configuration, test, or runtime evidence;
- smallest credible fix path;
- exact suggested replacement only when it is narrow and mechanical;
- prior-feedback relationship when applicable.

Malformed output gets one corrective protocol retry. A reviewer timeout or a second malformed response makes the run incomplete; it does not silently reduce coverage.

### Prior feedback

The host reads existing root review threads and earlier Blast Radius Buddy reports. It classifies relevant items as open, fixed, stale, resolved-but-still-present, author-resolved, dismissed, or suppressed.

Existing findings are revalidated but not duplicated. A materially reintroduced problem may be reported with new evidence. Pre-existing problems unrelated to the PR are excluded from actionable findings and may appear only as a compact non-blocking follow-up when they are both high-confidence and important.

## Validation

Validation is a confidence gate, not a mandatory repair exercise.

After synthesis, the host selects candidates for batched reproduction when any of these apply:

- only one first-pass reviewer reported a `medium` or more severe issue;
- the claim depends on runtime, configuration, framework, generated-code, migration, or compatibility behavior not proved directly in the packet;
- a deletion, fallback, or apparently redundant path may carry a hidden contract;
- severity, reachability, scope, or prior-feedback status remains uncertain;
- the finding is security-sensitive and lacks a direct execution or abuse path.

The reproduction worker uses an isolated temporary checkout at the captured head SHA. It performs read-only research and may run existing tests or safe diagnostic commands. It does not add tests, edit production code, apply fixes, commit, or push.

Each selected candidate becomes `confirmed`, `narrowed`, `downgraded`, `unclear`, or `refuted`. Unclear findings move to a non-actionable deferred section. Refuted findings are dropped. Two-reviewer agreement plus direct code evidence may be enough to skip reproduction.

After reproduction, one fresh-eyes verifier reviews only the synthesized findings, evidence, suggested fixes, prior-feedback treatment, and proposed review event. It attacks false positives, incorrect scope or severity, unsafe suggestions, and unjustified approval. This is not another broad PR review.

The normal successful path uses three broad reviewer calls, zero or one batched reproduction call, and one focused verification call. There are no adaptive rounds. Corrective retries repair protocol failures only and never become additional review rounds.

## GitHub lifecycle and copy

### Placeholder

The one marker comment starts with exactly:

> 🧨 Blast Radius Buddy is giving `<short-sha>` a careful shake; I'll keep this comment updated as the review moves.

The stable hidden marker follows the sentence. A three-item checklist shows the state of the three-angle review, finding validation, and fresh-eyes verification. The helper updates the authenticated user's existing marker comment after each major stage instead of posting another one.

### Successful completion

The host submits one native GitHub review, then replaces the marker body with a short completion status containing the reviewed SHA and a link to that review.

The native review starts with exactly one playful sentence:

> 🧨 The shake is over; here's what held and what came loose.

The rest is direct and functional:

1. verdict and reviewed head SHA;
2. actionable findings, with inline anchors where reliable;
3. prior-feedback status;
4. validation performed and its effect;
5. deferred uncertainties or important out-of-scope follow-ups;
6. three-angle coverage.

Inline suggested-change blocks appear only when the replacement is local, mechanical, and safe to apply without judgment. Cross-file, architectural, generated-code, deleted-line, or uncertain fixes remain prose suggestions.

### Failure and stale state

The marker must never remain in a working state after the run stops.

- On failure, replace it with `Blast Radius Buddy could not complete the review of <short-sha>: <exact reason>.`
- If the PR head changes, replace it with `Blast Radius Buddy stopped because the PR moved from <old-sha> to <new-sha>. Run it again for the new revision.`
- Do not submit a native review against a stale revision.

## Verdict and approval gates

Submit `COMMENT` when at least one actionable finding survives or when a completed review has material uncertainty that should be visible to the author. Never submit `REQUEST_CHANGES` in v1.

If the run fails before completing the review or the head becomes stale, update the marker only. Do not submit a native review event.

Submit `APPROVE` only when all of these are true:

- all three first-pass reviewers completed with valid output;
- selected reproduction completed or produced no material unresolved uncertainty;
- the fresh-eyes verifier upheld the clean verdict;
- no new or still-present in-scope `critical`, `high`, or meaningful `medium` finding remains;
- no known failed required CI check contradicts the clean verdict;
- the PR head still matches the captured SHA.

Approval means the code review found no actionable defect within its bounded scope. It does not claim that every CI check passed or that the PR is merge-ready.

## Deterministic components

Scripts, rather than prompt prose, should own fragile mechanics:

- resolving PRs from URL, number, or current branch;
- reading head/base metadata and current review history;
- creating and updating the marker comment;
- checking for a stale head;
- parsing and validating reviewer protocols;
- deduplicating stable findings;
- posting native reviews and inline comments;
- selecting `COMMENT` or `APPROVE` from explicit gates;
- creating and cleaning the temporary reproduction checkout.

`SKILL.md` remains concise. Detailed reviewer schemas, validation rules, and GitHub report shapes live in one-level `references/` files and are loaded only when needed.

## Error handling

- Give first-pass and fresh-eyes model calls a seven-minute hard timeout. Give reproduction ten minutes because it may run existing tests. Allow one corrective retry with the same timeout after a timeout or malformed protocol response.
- Treat missing required tools, authentication, permissions, repository access, or model access as explicit failures.
- Preserve the marker update even when later stages fail.
- Never fall back from native review posting to an unrequested approval, push, or branch mutation.
- If inline anchors are invalid, preserve the finding in the review body rather than dropping it or posting an incorrect line comment.
- If approval submission fails, update the marker with the exact GitHub error and do not claim approval.

## Testing

Implementation follows skill TDD: first run fresh-agent scenarios without the revised skill and record the actual gaps, then revise the skill and rerun the same scenarios.

Automated tests cover:

- exact placeholder and final opening copy;
- URL, PR-number, and current-branch resolution;
- current-user marker adoption and legacy-marker migration;
- head-SHA capture and stale-head refusal;
- prior-thread classification and duplicate suppression;
- strict reviewer schema parsing and one-retry behavior;
- validation candidate selection and classification effects;
- mechanical suggested-change eligibility;
- `APPROVE` versus `COMMENT` gate selection;
- native-review payloads and inline-comment fallback;
- failure replacement of the working marker;
- no commits, pushes, thread resolution, merges, or `REQUEST_CHANGES`.

All GitHub tests use mocked `gh` responses. Forward tests use disposable fixtures and never write to a live pull request.

## Out of scope for v1

- Automatic webhook or GitHub App triggers.
- Watching for mentions or review assignments.
- Editing code, adding tests, applying suggested fixes, committing, or pushing.
- Multiple review rounds or automatic re-review after new commits.
- Resolving review threads or merging.
- Supporting review severities below meaningful `medium`.
