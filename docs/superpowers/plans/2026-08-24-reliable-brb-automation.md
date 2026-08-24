# Reliable Blast Radius Buddy Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship and activate a restart-safe automatic BRB reviewer for every eligible Nex PR from the configured author using three Claude angle reviews followed by one Codex synthesis-verification stage.

**Architecture:** A deterministic Node coordinator derives work from GitHub, owns leases and retries, launches isolated model CLIs, validates every artifact, and performs the existing guarded GitHub writes. Hermes runs only the checked-in coordinator wrapper every five minutes and launchd keeps the Hermes gateway alive after login or restart.

**Tech Stack:** Node.js 24 ESM, Node test runner, GitHub CLI, Claude Code CLI, Codex CLI, Hermes cron, macOS launchd.

## Global Constraints

- Add no dependency.
- Keep repository, author, reviewer, model aliases, credentials, and local paths outside the public repository.
- Process only open, ready-for-review PRs whose required checks pass.
- Treat `head:<sha>` and same-head `review-requested:<event-id>` as distinct triggers.
- Run three logical Claude angles before one logical Codex synthesis-verification stage.
- Give each logical reviewer at most one fresh retry and seven minutes per attempt.
- Enforce a thirty-minute trigger deadline and reclaim abandoned work.
- Keep at most one editable BRB top-level comment per PR.
- Never edit code, commit, push, merge, submit `REQUEST_CHANGES`, resolve threads, or message a team space.
- Fail closed on missing models, invalid output, stale heads, failing checks, or deferred findings.

## File map

- `skills/blast-radius-buddy/scripts/github-watch.mjs`: read-only GitHub discovery and stable trigger generation.
- `skills/blast-radius-buddy/scripts/reviewer-runner.mjs`: shared child lifecycle plus isolated Claude and Codex launchers.
- `skills/blast-radius-buddy/scripts/review-protocol.mjs`: strict Codex synthesis envelope validation.
- `skills/blast-radius-buddy/scripts/run-state.mjs`: local lease, heartbeat, deadline, and retry metadata.
- `skills/blast-radius-buddy/scripts/review-coordinator.mjs`: end-to-end deterministic pipeline and CLI.
- `skills/blast-radius-buddy/scripts/review-comment.mjs`: working, retry, incomplete, and final marker rendering with trigger metadata.
- `skills/blast-radius-buddy/scripts/github-review.mjs`: trigger-bound native review metadata and final state validation.
- `skills/blast-radius-buddy/references/reviewer-prompts.md`: Claude and Codex prompt recipes.
- `skills/blast-radius-buddy/references/github-report.md`: automatic artifact and completion metadata contract.
- `skills/blast-radius-buddy/SKILL.md`: automatic invocation and safety contract.
- `tests/github-watch.test.mjs`: trigger eligibility and GitHub parsing.
- `tests/reviewer-runner.test.mjs`: Codex isolation, lifecycle, and CLI behavior.
- `tests/review-protocol.test.mjs`: synthesis schema and event invariants.
- `tests/run-state.test.mjs`: leases, deadlines, and backoff.
- `tests/review-coordinator.test.mjs`: pipeline order, failure recovery, and guarded writes.
- `tests/review-comment.test.mjs`: one-marker automatic states.
- `tests/github-review.test.mjs`: trigger metadata and native review binding.
- `tests/blast-radius-buddy-contract.test.mjs`: shipped helper and written contract.
- `tests/scenarios/blast-radius-buddy.md`: no-skill control and forward-test evidence.
- `~/.hermes/scripts/nex-brb-watch.sh`: private deployment wrapper.
- `~/.hermes/cron/jobs.json`: one enabled five-minute no-agent job, created through Hermes CLI.
- `~/Library/LaunchAgents/…`: Hermes-managed user gateway service.

---

### Task 1: GitHub trigger discovery

**Files:**
- Create: `tests/github-watch.test.mjs`
- Create: `skills/blast-radius-buddy/scripts/github-watch.mjs`

**Interfaces:**
- Consumes: `findEligibleTriggers({ repo, author, reviewer, execute })` and GitHub CLI JSON.
- Produces: sorted objects shaped as `{ repo, number, url, headSha, triggerId, triggerKind }` where `triggerKind` is `head | review-requested`.

- [ ] **Step 1: Write failing trigger tests**

Cover exact author matching, draft exclusion, required-check states, legacy BRB completion, new head, latest same-head matching `review_requested` event, unrelated reviewer events, dismissed reviews, malformed metadata, and stable PR-number ordering. Use injected `fakeExecute` responses; assert no write-capable GitHub command occurs.

```js
const triggers = await findEligibleTriggers({
  repo: 'acme/widget',
  author: 'contributor',
  reviewer: 'reviewer',
  execute,
});
assert.deepEqual(triggers, [{
  repo: 'acme/widget',
  number: 42,
  url: 'https://github.com/acme/widget/pull/42',
  headSha: HEAD,
  triggerId: 'review-requested:9001',
  triggerKind: 'review-requested',
}]);
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/github-watch.test.mjs`
Expected: FAIL with module-not-found for `github-watch.mjs`.

- [ ] **Step 3: Implement strict read-only discovery**

Export:

```js
export function parseCompletionMetadata(body) {}
export function selectTrigger({ headSha, reviews, timeline, reviewer }) {}
export async function findEligibleTriggers({ repo, author, reviewer, execute = defaultExecute }) {}
```

Use `gh pr list`, `gh pr checks --required`, paginated PR reviews, and the issue timeline. Select the newest matching re-request event not completed by trigger-bound BRB metadata; otherwise select the incomplete head trigger. Validate every external field and print one compact JSON object per line from the CLI.

- [ ] **Step 4: Run GREEN and the full suite**

Run: `node --test tests/github-watch.test.mjs && npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/github-watch.test.mjs skills/blast-radius-buddy/scripts/github-watch.mjs
git commit -m "feat: discover automatic BRB triggers"
```

### Task 2: Isolated Codex reviewer runner

**Files:**
- Modify: `tests/reviewer-runner.test.mjs`
- Modify: `skills/blast-radius-buddy/scripts/reviewer-runner.mjs`

**Interfaces:**
- Consumes: the existing `runReviewer` retry/lifecycle wrapper.
- Produces: `launchCodex({ cwd, input, signal }, dependencies)` and CLI command `run-codex` with the same protocol validation boundary as `run-claude`.

- [ ] **Step 1: Write failing Codex launcher tests**

Assert exact command arguments, stdin prompt bytes, neutral cwd, minimal environment, combined 10 MiB capture cap, TERM/KILL/close behavior, seven-minute timeout support, no retry for launch/auth/model failures, and one retry for timeout or malformed protocol.

```js
assert.deepEqual(CODEX_REVIEW_ARGS, [
  'exec', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only',
  '--skip-git-repo-check', '--model', 'gpt-5.6-sol', '-',
]);
```

- [ ] **Step 2: Run RED**

Run: `node --test --test-name-pattern='Codex|run-codex' tests/reviewer-runner.test.mjs`
Expected: FAIL because `launchCodex` and `run-codex` do not exist.

- [ ] **Step 3: Generalize child lifecycle and add Codex**

Keep the existing public Claude behavior. Extract a provider-labelled child launcher so error messages identify `Claude` or `Codex`, whitelist only required auth/config environment keys, and make `run-codex` require `--model`. Do not add a shell.

```js
export function launchCodex({ cwd, input, signal }, {
  model,
  spawnImpl = spawn,
  termGraceMs = 1_000,
  killGuardMs = 1_000,
} = {}) {}
```

- [ ] **Step 4: Run GREEN and full runner tests**

Run: `node --test tests/reviewer-runner.test.mjs`
Expected: all runner tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/reviewer-runner.test.mjs skills/blast-radius-buddy/scripts/reviewer-runner.mjs
git commit -m "feat: add isolated Codex reviewer"
```

### Task 3: Codex synthesis-verification protocol

**Files:**
- Modify: `tests/review-protocol.test.mjs`
- Modify: `skills/blast-radius-buddy/scripts/review-protocol.mjs`
- Modify: `skills/blast-radius-buddy/references/reviewer-prompts.md`

**Interfaces:**
- Consumes: exact head SHA, trigger ID, three validated angle results, prior ledger, and changed-line map.
- Produces: `validateSynthesisResult(value, { headSha, triggerId }) -> { status, headSha, triggerId, report, gates, verification }` from one fenced `brb-synthesis` block. The coordinator then passes `report`, `gates`, and `verification` through the existing `prepareReview` validator before any write.

- [ ] **Step 1: Write failing synthesis tests**

Test the complete envelope, `needs-context`, exact field rejection, report/gate/verification consistency, stable IDs, anchor validation inputs, deferred findings blocking approval, and `COMMENT | APPROVE` only.

```js
const value = validateSynthesisResult(parsed, { headSha: HEAD, triggerId: `head:${HEAD}` });
assert.equal(value.gates.event, 'APPROVE');
assert.equal(value.report.headSha, HEAD);
```

- [ ] **Step 2: Run RED**

Run: `node --test --test-name-pattern='synthesis' tests/review-protocol.test.mjs`
Expected: FAIL because `validateSynthesisResult` is not exported.

- [ ] **Step 3: Implement the strict envelope**

Validate the exact synthesis envelope and trigger identity in `review-protocol.mjs`; do not copy the normalized report schema into this module. Require coverage for all three angles. The coordinator must pass the returned `report`, `gates`, and `verification` to existing `prepareReview`, which remains their strict cross-artifact validator. Add the exact Codex prompt recipe with untrusted-data boundaries and no tools.

```js
export function validateSynthesisResult(value, expected) {
  const normalized = validateExactSynthesisEnvelope(value);
  if (normalized.headSha !== expected.headSha) {
    throw new TypeError('synthesis head does not match captured head');
  }
  if (normalized.triggerId !== expected.triggerId) {
    throw new TypeError('synthesis trigger does not match queued trigger');
  }
  return normalized;
}
```

- [ ] **Step 4: Run GREEN and contract tests**

Run: `node --test tests/review-protocol.test.mjs tests/blast-radius-buddy-contract.test.mjs`
Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/review-protocol.test.mjs skills/blast-radius-buddy/scripts/review-protocol.mjs skills/blast-radius-buddy/references/reviewer-prompts.md
git commit -m "feat: validate BRB synthesis results"
```

### Task 4: Durable leases and retry state

**Files:**
- Create: `tests/run-state.test.mjs`
- Create: `skills/blast-radius-buddy/scripts/run-state.mjs`

**Interfaces:**
- Consumes: a caller-owned absolute state directory, trigger key, injected clock, and process liveness check.
- Produces: `acquireLease`, `heartbeatLease`, `releaseLease`, `recordFailure`, `recordSuccess`, and `nextEligibleAt` with atomic JSON replacement.

- [ ] **Step 1: Write failing state tests**

Use one temporary directory per test. Cover exclusive acquisition, live-owner refusal, dead-owner reclamation, expired deadline, heartbeat, owner mismatch, atomic malformed-state refusal, 5/15/30/60-minute backoff, attempt reset after success, and separate state for new triggers.

```js
const lease = await acquireLease({ stateDir, triggerKey, now, pid, isProcessAlive });
assert.equal(lease.acquired, true);
assert.equal((await acquireLease({ stateDir, triggerKey, now, pid: 2, isProcessAlive })).acquired, false);
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/run-state.test.mjs`
Expected: FAIL with module-not-found for `run-state.mjs`.

- [ ] **Step 3: Implement atomic state**

Validate the state directory is absolute and the trigger key contains no path separators. Use `open(..., 'wx')` for acquisition, write-to-new-file plus rename for updates, and refuse unsafe cleanup targets. Store only trigger identity, pid, start/deadline/heartbeat timestamps, attempt count, failure category, and next eligible timestamp.

```js
export async function acquireLease({ stateDir, triggerKey, pid, now, deadlineMs, isProcessAlive }) {}
export async function heartbeatLease({ stateDir, triggerKey, ownerId, now }) {}
export async function releaseLease({ stateDir, triggerKey, ownerId }) {}
export async function recordFailure({ stateDir, triggerKey, category, now }) {}
export async function recordSuccess({ stateDir, triggerKey }) {}
export async function nextEligibleAt({ stateDir, triggerKey }) {}
```

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/run-state.test.mjs`
Expected: all state tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/run-state.test.mjs skills/blast-radius-buddy/scripts/run-state.mjs
git commit -m "feat: persist BRB run recovery state"
```

### Task 5: Deterministic coordinator

**Files:**
- Create: `tests/review-coordinator.test.mjs`
- Create: `skills/blast-radius-buddy/scripts/review-coordinator.mjs`
- Modify: `tests/review-comment.test.mjs`
- Modify: `skills/blast-radius-buddy/scripts/review-comment.mjs`

**Interfaces:**
- Consumes: validated watcher triggers and injected GitHub, packet-builder, reviewer, state, and clock dependencies.
- Produces: `runTrigger(options)` and `runQueue(options)` plus CLI `run --repo --author --reviewer --repository --state-dir --claude-model --codex-model [--dry-run]`.

- [ ] **Step 1: Write failing pipeline tests**

Assert three Claude calls start before any resolves, Codex starts only after all validate, Codex never starts after one failed angle, retry states remain eligible, deadline aborts outstanding children, stale head causes no native review, required-check recheck gates writes, dry-run performs no GitHub write, logs omit packets and credentials, PRs process sequentially, and completion records the exact trigger.

```js
assert.deepEqual(events.slice(0, 3), [
  'claude:security-and-abuse',
  'claude:system-blast-radius',
  'claude:feature-truth-and-adjacent-regressions',
]);
assert.equal(events[3], 'codex:synthesis');
```

- [ ] **Step 2: Write failing marker tests**

Add exact retry and incomplete copy, hidden trigger metadata, one-comment update behavior, and final report rendering without a second top-level prose artifact.

- [ ] **Step 3: Run RED**

Run: `node --test tests/review-coordinator.test.mjs tests/review-comment.test.mjs`
Expected: FAIL because the coordinator and automatic marker states do not exist.

- [ ] **Step 4: Implement coordinator and marker states**

Use dependency injection for every external boundary. Build the bounded packet deterministically, write no prompt packet to logs, call the existing review-history and GitHub preparation/submission helpers, refresh the lease between stages, and record structured stage results. Write marker state before model work and on every terminal or scheduled-retry exit.

```js
export async function runTrigger(options) {
  const lease = await options.state.acquire(options.trigger);
  if (!lease.acquired) return { status: 'leased' };
  try {
    const context = await options.github.capture(options.trigger);
    if (options.dryRun) return { status: 'eligible', trigger: options.trigger };
    await options.marker.working(context);
    const angles = await Promise.all(ANGLE_SLUGS.map(
      (angle) => options.reviewers.claude({ angle, context }),
    ));
    const synthesis = await options.reviewers.codex({ context, angles });
    return await options.github.submit({ context, synthesis });
  } finally {
    await options.state.release(lease);
  }
}
```

- [ ] **Step 5: Run GREEN and focused integration tests**

Run: `node --test tests/review-coordinator.test.mjs tests/review-comment.test.mjs tests/github-review.test.mjs`
Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/review-coordinator.test.mjs tests/review-comment.test.mjs skills/blast-radius-buddy/scripts/review-coordinator.mjs skills/blast-radius-buddy/scripts/review-comment.mjs
git commit -m "feat: coordinate automatic BRB reviews"
```

### Task 6: Trigger-bound native review metadata

**Files:**
- Modify: `tests/github-review.test.mjs`
- Modify: `skills/blast-radius-buddy/scripts/github-review.mjs`
- Modify: `skills/blast-radius-buddy/references/github-report.md`

**Interfaces:**
- Consumes: `triggerId` alongside current report, diff, gates, and verification artifacts.
- Produces: backward-compatible hidden metadata containing `headSha`, `triggerId`, `findings`, and `suggestions` and a returned native review state matching the derived event.

- [ ] **Step 1: Write failing metadata tests**

Test safe trigger formats, exact trigger propagation, legacy metadata parsing, same-head different-trigger completion, forged trigger rejection, native state mismatch, and stale-head refusal immediately before POST.

- [ ] **Step 2: Run RED**

Run: `node --test --test-name-pattern='trigger|native state|stale head' tests/github-review.test.mjs`
Expected: new trigger assertions fail.

- [ ] **Step 3: Implement trigger binding**

Require `head:<40-hex-sha>` or `review-requested:<positive-safe-integer>`. Include the trigger in prepared artifacts and recompute it at submit time. Keep old review bodies readable for head-trigger completion only.

```js
function reviewMetadata({ headSha, triggerId, findings, suggestions }) {
  return `<!-- blast-radius-buddy-review:${JSON.stringify({
    headSha, triggerId, findings, suggestions,
  })} -->`;
}
```

- [ ] **Step 4: Run GREEN and watcher integration tests**

Run: `node --test tests/github-review.test.mjs tests/github-watch.test.mjs tests/review-coordinator.test.mjs`
Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/github-review.test.mjs skills/blast-radius-buddy/scripts/github-review.mjs skills/blast-radius-buddy/references/github-report.md
git commit -m "feat: bind BRB reviews to triggers"
```

### Task 7: Skill contract and forward test

**Files:**
- Modify: `tests/blast-radius-buddy-contract.test.mjs`
- Modify: `tests/scenarios/blast-radius-buddy.md`
- Modify: `skills/blast-radius-buddy/SKILL.md`

**Interfaces:**
- Consumes: the deterministic helpers from Tasks 1-6.
- Produces: discoverable automatic invocation guidance that authorizes only marker and native-review writes for configured triggers.

- [ ] **Step 1: Add failing contract assertions and a no-skill control**

Assert the shipped watcher/coordinator/state helpers, three-Claude/one-Codex ordering, retry/restart behavior, same-head re-request support, and unchanged write prohibitions. Record how a fresh control agent mishandles at least one automatic trigger or recovery scenario without the revised skill.

- [ ] **Step 2: Run RED**

Run: `node --test tests/blast-radius-buddy-contract.test.mjs`
Expected: new automatic-contract assertions fail.

- [ ] **Step 3: Make the minimal skill and scenario update**

Keep `SKILL.md` below 700 words. Route detailed automatic behavior to the existing references and deterministic CLIs; do not duplicate the implementation plan.

```markdown
An explicitly installed automatic deployment authorizes the same one marker and
one native review as a direct invocation for each validated trigger. Discover
triggers with `github-watch.mjs`; execute them only through
`review-coordinator.mjs`. An automatic run is incomplete unless all three Claude
angles and the Codex synthesis-verification stage validate.
```

- [ ] **Step 4: Run GREEN and validate the skill**

Run: `node --test tests/blast-radius-buddy-contract.test.mjs && npm run check`
Expected: all  repository checks pass.

- [ ] **Step 5: Commit**

```bash
git add tests/blast-radius-buddy-contract.test.mjs tests/scenarios/blast-radius-buddy.md skills/blast-radius-buddy/SKILL.md
git commit -m "feat: automate Blast Radius Buddy reviews"
```

### Task 8: Private Hermes deployment and fault-injection verification

**Files:**
- Create outside repo: `~/.hermes/scripts/nex-brb-watch.sh`
- Modify outside repo: `~/.hermes/config.yaml` only if the installed Hermes version requires it for the job.
- Create through CLI: `~/.hermes/cron/jobs.json` job.
- Create through CLI: Hermes launchd user gateway service.

**Interfaces:**
- Consumes: checked-in coordinator, absolute Nex worktree, authenticated `gh`, Claude and Codex CLI auth.
- Produces: one enabled five-minute `--no-agent` cron job and a running launchd-backed Hermes gateway.

- [ ] **Step 1: Run repository verification**

Run: `npm test && npm run check && git diff --check`
Expected: all tests pass with no warnings or whitespace errors.

- [ ] **Step 2: Run fresh real model smoke tests**

Run one isolated Claude `sonnet` angle and one ephemeral read-only Codex `gpt-5.6-sol` synthesis fixture through the checked-in runner. Validate both with `review-protocol.mjs`; do not post to GitHub.

- [ ] **Step 3: Create the private wrapper**

Create a mode-`0700` wrapper that invokes the coordinator with explicit absolute repository/state paths and the private deployment values `Cisco-CollabAI/nex`, `mrshu_cisco`, and `hraska_cisco`. It must emit only structured status on stdout and diagnostics on stderr.

- [ ] **Step 4: Verify a direct no-write tick**

Run the wrapper in a dry-run/no-write mode against live GitHub. Expected: a stable eligible queue or explicit no-work result, no marker/review mutation, and no leaked private packet.

- [ ] **Step 5: Create the Hermes job and gateway service**

Use `hermes cron create 5m --name nex-brb-watch --script ~/.hermes/scripts/nex-brb-watch.sh --no-agent --workdir /Users/hraska/Code/cisco/nex`, then `hermes gateway install` and `hermes gateway start`. Verify exactly one enabled job and one running gateway.

- [ ] **Step 6: Fault-inject recovery**

With fake GitHub writes, terminate a reviewer and prove the coordinator records retry state; terminate the coordinator and prove a later tick reclaims the lease; stop the gateway and prove launchd restarts it. Quote exact run IDs and states in the handoff.

- [ ] **Step 7: Observe one scheduler tick**

Inspect `hermes cron runs JOB_ID --limit 5`. Expected: successful no-work suppression or a safely acquired eligible trigger. If a live GitHub write would occur, inspect the target, head, author, checks, and marker destination immediately before allowing the configured automatic write path to continue.

- [ ] **Step 8: Final verification and deployment commit boundary**

Run: `npm test && npm run check && git status --short --branch`
Expected: repository checks pass; only deliberate local deployment files exist outside git; unrelated `package-lock.json` and the superseded untracked August 13 plan remain untouched.
