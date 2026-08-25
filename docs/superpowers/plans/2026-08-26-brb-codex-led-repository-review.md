# BRB Codex-Led Repository Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BRB's repeated tool-less full-packet reviews with a Codex-led, repository-aware pipeline that uses two Codex angle reviewers, at most one Opus reviewer, and a fresh Codex final verifier.

**Architecture:** The coordinator creates a detached exact-head review workspace containing the checkout and trusted PR artifacts. A Codex scope assessor produces a validated coverage plan, three assigned angle reviewers inspect the workspace in parallel, and a fresh Codex verifies their findings before deterministic GitHub gates run. Quiet-until-complete suppresses all GitHub writes until a fully valid result is ready.

**Tech Stack:** Node.js 24 ESM, built-in `node:test`, Git worktrees, Claude Code CLI, Codex CLI, GitHub CLI.

## Global Constraints

- A healthy wave contains exactly two Codex reviewers and one Claude Opus reviewer.
- BRB never launches more than one Opus process for a trigger; an Opus failure may be replaced once by Codex for the same angle.
- Claude is pinned to `opus`, effort `medium`, prompt suggestions disabled, with read-only inspection tools only.
- Model processes receive no GitHub token and cannot write the checkout, run project code, or call GitHub.
- Every changed file receives a validated scope-plan disposition before angle review.
- Normal automation retains the working marker; quiet-until-complete makes no GitHub write unless the complete result passes every write-boundary gate.
- No new dependency, code edit to the reviewed PR, commit, push, merge, thread resolution, or `REQUEST_CHANGES`.

---

### Task 1: Validate Codex Scope Plans

**Files:**
- Modify: `skills/blast-radius-buddy/scripts/review-protocol.mjs`
- Modify: `tests/review-protocol.test.mjs`
- Modify: `skills/blast-radius-buddy/references/reviewer-prompts.md`

**Interfaces:**
- Consumes: changed repository-relative paths and the three canonical angle slugs.
- Produces: `validateReviewPlan(value, { headSha, triggerId, changedFiles })` returning a normalized plan with `assignments`, `clusters`, and `fileDispositions`.

- [ ] **Step 1: Write failing plan-protocol tests**

Add fixtures that expect this exact shape:

```js
const plan = {
  status: 'complete',
  headSha: HEAD,
  triggerId: `head:${HEAD}`,
  intent: 'Add durable retry state for failed sync jobs.',
  boundaries: ['local API scheduler', 'SQLite run state'],
  clusters: [{
    id: 'cluster-1',
    risk: 'high',
    reason: 'Retry state changes shared scheduling behavior.',
    changedFiles: ['src/jobs.ts'],
    relatedFiles: ['src/store.ts'],
    tests: ['tests/jobs.test.ts'],
  }],
  fileDispositions: [{
    path: 'src/jobs.ts',
    disposition: 'material',
    clusterId: 'cluster-1',
    reason: 'Changes retry transitions.',
  }],
  assignments: [
    { angle: 'security-and-abuse', provider: 'codex', reason: 'No new trust boundary.' },
    { angle: 'system-blast-radius', provider: 'claude', reason: 'Highest operational risk.' },
    { angle: 'feature-truth-and-adjacent-regressions', provider: 'codex', reason: 'Contract tracing.' },
  ],
  missingContext: [],
};
```

Reject missing/extra changed files, duplicate file dispositions, absolute or traversal paths, unknown cluster references, duplicate/missing angles, more than one Claude assignment, a Claude model name in place of provider `claude`, mismatched identity, and a complete plan with non-empty `missingContext`.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test tests/review-protocol.test.mjs`

Expected: FAIL because `validateReviewPlan` is not exported.

- [ ] **Step 3: Implement strict normalization**

Add exact field sets, enums for `material|mechanical|low-risk`, `low|medium|high`, and `codex|claude`, identity validation, repository-path validation, complete changed-file set equality, cluster linkage checks, three unique canonical assignments, and at most one Claude assignment. Return only normalized fields.

- [ ] **Step 4: Document the `brb-plan` prompt envelope**

Add the exact scope-assessor role, artifact paths, untrusted-data boundary, coverage requirements, and fenced `brb-plan` JSON contract to `reviewer-prompts.md`. State that the assessor maps scope and does not produce findings.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `node --test tests/review-protocol.test.mjs`

Expected: all review-protocol tests pass.

- [ ] **Step 6: Commit**

```bash
git add skills/blast-radius-buddy/scripts/review-protocol.mjs \
  skills/blast-radius-buddy/references/reviewer-prompts.md \
  tests/review-protocol.test.mjs
git commit -m "feat: validate BRB repository review plans"
```

### Task 2: Create Exact-Head Review Workspaces

**Files:**
- Create: `skills/blast-radius-buddy/scripts/review-workspace.mjs`
- Create: `tests/review-workspace.test.mjs`

**Interfaces:**
- Consumes: `{ repository, context, execute, inspect }` where `context` contains exact PR identity, diff, changed lines, prior ledger, and changed file list.
- Produces: `withReviewWorkspace(options)` calling `inspect({ root, checkout, artifacts })` and cleaning the exact worktree afterward.

- [ ] **Step 1: Write failing workspace lifecycle tests**

Cover validation, `git worktree add --detach <checkout> <headSha>`, exact `git rev-parse HEAD`, trusted artifact creation with mode `0600`, nested `AGENTS.md` discovery from changed file parents toward root, post-inspection `git status --porcelain`, worktree removal, safe temporary-root removal, and preservation when a child cannot terminate.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/review-workspace.test.mjs`

Expected: FAIL because `review-workspace.mjs` does not exist.

- [ ] **Step 3: Implement the workspace helper**

Create a temporary root using the fixed prefix `blast-radius-buddy-workspace-`. Add a detached worktree at `checkout/`, verify its full SHA, write these artifacts under `artifacts/`, and pass absolute paths to `inspect`:

```text
pr.json
diff.patch
changed-lines.json
prior-feedback.md
agent-rules.json
```

Represent nested rules as `{ path, appliesTo, content }`. Never follow a changed-file path outside the checkout. Refuse cleanup of any path outside the fixed temporary prefix.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --test tests/review-workspace.test.mjs`

Expected: all workspace tests pass.

- [ ] **Step 5: Commit**

```bash
git add skills/blast-radius-buddy/scripts/review-workspace.mjs \
  tests/review-workspace.test.mjs
git commit -m "feat: add exact-head BRB review workspaces"
```

### Task 3: Give Reviewers Bounded Read-Only Repository Access

**Files:**
- Modify: `skills/blast-radius-buddy/scripts/reviewer-runner.mjs`
- Modify: `tests/reviewer-runner.test.mjs`

**Interfaces:**
- Consumes: launch options `{ cwd, input, signal, onActivity }` and provider options `{ model, repositoryAccess }`.
- Produces: Codex launches rooted at the detached checkout; Claude launches with only `Read,Glob,Grep`, Opus medium effort, and prompt suggestions off.

- [ ] **Step 1: Write failing launcher-argument tests**

Assert Claude repository mode includes:

```js
['--safe-mode', '--tools', 'Read,Glob,Grep', '--disable-slash-commands',
 '--no-session-persistence', '--permission-mode', 'dontAsk', '--print',
 '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
 '--effort', 'medium', '--prompt-suggestions', 'false', '--model', 'opus']
```

Assert it contains no Bash, Edit, Write, Web, or GitHub tool. Assert Codex retains `--ephemeral`, `--ignore-user-config`, `--sandbox read-only`, and uses the checkout as `-C`. Assert provider environments omit `GH_TOKEN`, `GITHUB_TOKEN`, and unrelated credentials.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/reviewer-runner.test.mjs`

Expected: FAIL because repository-aware launcher options are absent.

- [ ] **Step 3: Implement explicit repository modes**

Keep the existing tool-less mode for reproduction helpers. Add repository-aware Claude and Codex launcher configuration without changing `runReviewer` protocol validation or child termination. Provider authentication remains the only provider-specific secret exposure.

- [ ] **Step 4: Add shared stage-budget retry support**

Change `runReviewer` so an optional `stageDeadlineAt` caps every attempt to the remaining stage budget. A retry receives only remaining time. Emit content-free attempt events for replacement and exhaustion.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `node --test tests/reviewer-runner.test.mjs`

Expected: all reviewer-runner tests pass.

- [ ] **Step 6: Commit**

```bash
git add skills/blast-radius-buddy/scripts/reviewer-runner.mjs \
  tests/reviewer-runner.test.mjs
git commit -m "feat: allow read-only BRB repository inspection"
```

### Task 4: Replace the Coordinator Pipeline

**Files:**
- Modify: `skills/blast-radius-buddy/scripts/review-coordinator.mjs`
- Modify: `tests/review-coordinator.test.mjs`
- Modify: `skills/blast-radius-buddy/references/review-angles.md`

**Interfaces:**
- Consumes: `workspace.create`, reviewer methods `assess`, `reviewCodex`, `reviewClaude`, and `synthesize`.
- Produces: `runTrigger` sequence `capture -> workspace -> assess -> three assigned reviews -> synthesize -> deterministic gates -> submit`.

- [ ] **Step 1: Replace the happy-path coordinator test with a failing topology test**

Assert this order:

```text
marker:working
workspace:create
codex:assess
codex:<assigned-angle>
claude:<assigned-angle>
codex:<assigned-angle>
codex:synthesis
github:submit
marker:complete
```

The three angle starts must occur before any resolves, proving parallel dispatch. Assert the plan controls which one uses Claude and that all three canonical angles appear exactly once.

- [ ] **Step 2: Add failing failure-policy tests**

Cover assessment failure before reviewer dispatch, Codex angle retry, Opus failure followed by exactly one Codex replacement for the same angle, replacement exhaustion, synthesis blocked until three results validate, workspace dirtiness, and whole-run abort. Assert no path launches a second Opus.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `node --test tests/review-coordinator.test.mjs`

Expected: topology and failure-policy tests fail against the old three-Claude pipeline.

- [ ] **Step 4: Implement plan and angle prompts**

Replace `buildBoundedPacket` with concise trusted-artifact path prompts. Build the assessor prompt from PR identity and workspace paths. Build each angle prompt from the normalized plan, assigned rubric, and workspace paths. Require reviewers to inspect cited surrounding code and return the existing strict `brb-review` envelope.

- [ ] **Step 5: Implement the staged coordinator**

Create the workspace after capture. Run assessment before any angle. Dispatch plan assignments in parallel. Route provider `claude` to Opus and provider `codex` to Codex. On exhausted Opus failure, run one Codex replacement for that angle. Pass `{ plan, results, workspace paths }` to fresh Codex synthesis. Keep exact-head, required-check, anchor, deterministic-event, state, and lease gates.

- [ ] **Step 6: Set fixed timing**

Export and use:

```js
export const ASSESSMENT_BUDGET_MS = 10 * 60_000;
export const ANGLE_WAVE_BUDGET_MS = 10 * 60_000;
export const SYNTHESIS_BUDGET_MS = 10 * 60_000;
export const REVIEWER_INACTIVITY_TIMEOUT_MS = 5 * 60_000;
```

Change the durable lease default to 45 minutes and preserve one-minute heartbeats.

- [ ] **Step 7: Run focused tests and confirm GREEN**

Run: `node --test tests/review-coordinator.test.mjs`

Expected: all coordinator tests pass.

- [ ] **Step 8: Commit**

```bash
git add skills/blast-radius-buddy/scripts/review-coordinator.mjs \
  skills/blast-radius-buddy/references/review-angles.md \
  tests/review-coordinator.test.mjs
git commit -m "feat: make Codex lead BRB reviews"
```

### Task 5: Add Quiet-Until-Complete Publication

**Files:**
- Modify: `skills/blast-radius-buddy/scripts/review-coordinator.mjs`
- Modify: `tests/review-coordinator.test.mjs`
- Modify: `skills/blast-radius-buddy/SKILL.md`
- Modify: `tests/blast-radius-buddy-contract.test.mjs`

**Interfaces:**
- Consumes: CLI flag `--quiet-until-complete`.
- Produces: zero marker or review writes until all local stages and gates pass; then one native review and one final marker update.

- [ ] **Step 1: Write failing quiet-publication tests**

Assert assessment, angle, synthesis, required-check, stale-head, invalid-anchor, and submission-preparation failures produce no marker method and no `github.submit`. Assert success calls `github.submit` before `marker.complete`, with no earlier marker method.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/review-coordinator.test.mjs tests/blast-radius-buddy-contract.test.mjs`

Expected: FAIL because the flag and contract do not exist.

- [ ] **Step 3: Implement the flag and lifecycle**

Parse `--quiet-until-complete`. In `runTrigger`, skip working, retry, incomplete, and stale marker writes in quiet mode. Preserve local state and diagnostics. On success, submit only after the second exact-head/check recheck and then call `marker.complete` once.

- [ ] **Step 4: Update the skill contract**

Document the Codex-led topology, exact checkout inspection, one-Opus maximum, Codex replacement, 45-minute lease, and supervised quiet rollout. Remove the obsolete three-Opus/full-packet requirements.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `node --test tests/review-coordinator.test.mjs tests/blast-radius-buddy-contract.test.mjs`

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add skills/blast-radius-buddy/scripts/review-coordinator.mjs \
  skills/blast-radius-buddy/SKILL.md \
  tests/review-coordinator.test.mjs \
  tests/blast-radius-buddy-contract.test.mjs
git commit -m "feat: publish silent BRB runs only on success"
```

### Task 6: Full Verification, Live Smokes, and Deployment

**Files:**
- Modify: `tests/scenarios/blast-radius-buddy.md`
- Modify outside repository: installed watcher wrapper under `~/.hermes/scripts/`

**Interfaces:**
- Consumes: completed test suite, authenticated `codex`, authenticated `claude`, authenticated `<username>_cisco` `gh` account, validation PR URL.
- Produces: verified local implementation, silent PR result, conditional published review, and updated watcher.

- [ ] **Step 1: Run repository verification**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected: all commands pass with no warnings or whitespace errors.

- [ ] **Step 2: Run isolated live model smokes**

Create a temporary fixture repository. Run the production Codex assessor path and confirm a valid `brb-plan`. Run the production Opus medium repository-review path and confirm a valid `brb-review`. Verify the checkout remains clean and the process environments contain no GitHub credential variables.

- [ ] **Step 3: Run PR 17912 in quiet-until-complete mode**

Invoke the coordinator against `sli-do/slido-frontend#17912` with the exact local repository path, isolated state directory, explicit `opus` and `gpt-5.6-sol`, and `--quiet-until-complete`. Tail structured logs. Confirm no GitHub marker or review exists while stages are active.

- [ ] **Step 4: Validate before publication**

Confirm the result is complete, all changed files have dispositions, all three angles validated, the exact head is unchanged, required checks pass, every inline anchor is a changed new-side line, the event matches deterministic gates, and `gh api user --jq .login` is the intended reviewer account. If any check fails, make no GitHub write and fix locally.

- [ ] **Step 5: Confirm the conditional live write**

On a valid result, confirm exactly one native GitHub review and one final BRB marker were created. Inspect the review body, inline findings, URLs, reviewed SHA, and absence of Sonnet/Haiku attribution or duplicate comments.

- [ ] **Step 6: Update and verify the installed watcher**

Update the wrapper to use the Codex-led coordinator with explicit `opus`, `gpt-5.6-sol`, and normal marker mode. Run one no-work tick, inspect Hermes/launchd state, and confirm restart recovery remains installed.

- [ ] **Step 7: Run final repository verification and commit any documentation adjustments**

```bash
npm test
npm run check
git status --short
```

Record the completed smoke and rollout evidence in the scenario document, then
commit that scoped file:

```bash
git add tests/scenarios/blast-radius-buddy.md
git commit -m "docs: record Codex-led BRB verification"
```
