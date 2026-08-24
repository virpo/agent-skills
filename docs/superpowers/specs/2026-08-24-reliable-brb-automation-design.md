# 🧨 Reliable Blast Radius Buddy Automation Design

## Status

This design supersedes the local automation portions of
`2026-08-13-blast-radius-buddy-hermes-automation-design.md`. The existing BRB
review and GitHub safety contracts remain in force unless this document changes
them explicitly.

## Goal

Automatically review every eligible Nex pull request authored by the configured
GitHub user. Each run must use three isolated Claude angle reviewers followed by
one isolated Codex synthesis verifier, recover from failures and abandoned work,
survive user login and computer restarts, and resume within five minutes after
the Mac wakes.

The local service cannot run while macOS is asleep. It catches up on the first
five-minute scheduler tick after wake.

Repository, author, reviewer login, model aliases, and local paths are deployment
configuration. They must not be committed to this public repository.

## Trigger contract

The watcher polls GitHub every five minutes. A pull request is eligible only when
all of these are true:

- it is open and not a draft;
- its author exactly matches the configured author;
- every required GitHub check is complete and passing;
- it has a trigger not already completed by BRB.

BRB recognizes these triggers:

1. `head:<sha>` for a current head SHA that BRB has not completed;
2. `review-requested:<event-id>` for a later GitHub `review_requested` event that
   targets the configured reviewer, including a same-head re-review request.

A new head creates a new head trigger. A review-request event creates a new
trigger even when the head is unchanged. Events that target another reviewer do
not retrigger this deployment. Pending or failing checks leave the trigger
queued for a later poll.

The unit of work is `repository + pull request number + head SHA + trigger ID`.
Completed BRB metadata records all four values. An unrelated review, a stale
marker, or an incomplete run never suppresses a trigger.

## Runtime architecture

Hermes provides scheduling and process persistence, not review judgment.

1. A Hermes five-minute cron job invokes a local wrapper under
   `~/.hermes/scripts/` with `--no-agent`.
2. The wrapper runs the checked-in deterministic BRB coordinator.
3. The coordinator discovers eligible triggers, acquires a lease, and processes
   them sequentially in stable pull-request order.
4. The coordinator owns GitHub reads and writes, model process launches,
   protocol validation, timeout enforcement, retries, and final gates.
5. The Hermes gateway is installed as a macOS launchd user service so it starts
   after login and restarts after failure.

No Hermes model call decides whether the required reviewers ran. Empty watcher
output is a successful no-work tick.

## Review pipeline

For each trigger, the coordinator:

1. Resolves the pull request, captures the exact head SHA, complete diff,
   relevant context, prior-feedback ledger, checks, and trigger metadata.
2. Creates or updates the one BRB top-level marker to the working state.
3. Builds one bounded untrusted-data packet with 20 percent of each model's
   context reserved for output.
4. Starts three logical Claude reviews in parallel, one for each canonical
   angle. Each logical review must yield one validated result and may use only
   the bounded retry described below:
   - `security-and-abuse`;
   - `system-blast-radius`;
   - `feature-truth-and-adjacent-regressions`.
5. Validates each result against its assigned angle and the existing BRB review
   protocol. Missing, malformed, timed-out, or mismatched output makes the run
   incomplete.
6. Starts one logical Codex synthesis-verification stage only after all three
   Claude results validate. Codex receives the bounded packet, prior-feedback
   ledger, and three normalized angle results. It deduplicates findings,
   challenges reachability and severity, validates suggestions and anchors, and
   returns the final normalized report plus proposed `COMMENT` or `APPROVE`
   event. Its bounded retry is a new isolated attempt for the same logical stage,
   not an additional reviewer role.
7. Applies deterministic final gates: all four reviewers completed, every schema
   validates, required checks still pass, inline anchors exist on changed
   new-side lines, approval has no actionable or deferred finding, and the head
   SHA is unchanged.
8. Submits one native review. BRB never submits `REQUEST_CHANGES`.
9. Edits the same top-level marker into the final concise report. Actionable
   findings and optional suggestions use anchored inline comments when GitHub can
   place them reliably.

The configured initial deployment uses Claude `sonnet` and Codex
`gpt-5.6-sol`. A missing or unavailable configured model fails closed; the
coordinator does not silently substitute another model.

Automated mode does not invent or run open-ended reproduction commands. When
runtime proof is necessary and the bounded packet cannot establish the claim,
Codex marks it deferred and the deterministic gate blocks `APPROVE`. The
existing host-selected diagnostic workflow remains available for a manually
supervised BRB run.

## Isolation and trust boundary

Every model call starts in a fresh neutral temporary directory.

- Claude runs non-interactively with safe mode, no tools, no session persistence,
  and the existing fixed BRB arguments.
- Codex runs non-interactively with an ephemeral session, ignored user config, an
  empty working directory, and a read-only sandbox.
- Model calls receive bounded packet text, not target-repository access,
  connectors, GitHub credentials, or GitHub write tools.
- Repository content is explicitly untrusted data. Model output is parsed and
  validated before it can affect a GitHub write.
- Only the deterministic coordinator can call GitHub or update local run state.

Smoke tests on 2026-08-24 confirmed both configured CLI paths can emit output
accepted by BRB's existing protocol validator under these isolation modes.

## Leases, timeouts, and recovery

The queue is derived from GitHub on every tick, so it cannot be lost with a
local process. Local state contains only leases, attempt metadata, and concise
diagnostics.

- Each reviewer has a seven-minute hard timeout.
- The three Claude reviewers run concurrently; Codex starts after they finish.
- Each trigger has a thirty-minute whole-run deadline, covering one retry for
  every logical reviewer stage without allowing an abandoned run to live
  indefinitely.
- A lease includes the trigger key, owner process identity, start time, deadline,
  and heartbeat. Only one coordinator may own a trigger.
- A live coordinator refreshes its heartbeat. A dead owner or expired deadline
  makes the lease reclaimable.
- Timeout handling sends graceful termination, escalates to forced termination,
  and waits for child close before releasing or reusing its directory.
- A timed-out or malformed model response gets one immediate fresh-context retry.
- An incomplete run remains eligible. Abandoned or interrupted work retries on
  the next five-minute tick. Repeated launch, authentication, permission, model,
  or protocol failures back off to 5, 15, 30, then 60 minutes while remaining
  visible in the marker and Hermes run history.
- A new head or new review-request trigger starts with a fresh retry budget.

After sleep, elapsed deadlines fire when the process resumes; the coordinator
terminates overdue children and exits incomplete. The next scheduler tick
reclaims the trigger. After restart, launchd restarts the Hermes gateway after
login and the next tick rediscovers unfinished GitHub work.

## GitHub artifact contract

Each pull request has at most one BRB top-level comment, identified by hidden
metadata. Every run edits that comment through these states:

- working;
- retry scheduled with a concise reason and next attempt;
- incomplete with a concrete operator action when automatic retry cannot help;
- final current result.

The final marker is the canonical human-readable report. Native review bodies
carry only the minimum transport and hidden completion metadata needed for
GitHub state and idempotency. A clean result uses native `APPROVE`; a result with
actionable findings uses native `COMMENT`; failures and stale heads submit no
native review.

Prior BRB inline findings remain in GitHub history. A rerun does not duplicate a
semantically identical active finding. A changed head may re-anchor a still
relevant finding when the prior anchor no longer describes the current code.

## Safety and authorization

The local deployment is authorized only for the configured repository, author,
and reviewer. It may update BRB's one marker and submit BRB's one native review
with inline comments. It may not edit code, create commits, push, merge, submit
`REQUEST_CHANGES`, resolve threads, change pull-request metadata, or message a
team space.

The coordinator uses the existing authenticated GitHub CLI account. Secrets and
private deployment values stay outside the public repository.

## Observability

Every tick records a concise structured result:

- no eligible work;
- trigger acquired or skipped because another live lease owns it;
- current pipeline stage and elapsed time;
- reviewer model family, configured model, attempt number, and outcome;
- GitHub marker and native-review URLs;
- retry reason and next eligible time;
- final event and exact reviewed head SHA.

Logs must not include model credentials, GitHub tokens, full private prompts, or
unredacted repository packets.

## Testing and acceptance

Implementation is test-first and adds no dependency.

Unit and contract tests cover:

- exact repository, author, and configured-reviewer filtering;
- initial head, new head, same-head re-request, and unrelated review-request
  triggers;
- draft and required-check gates;
- stable trigger IDs and GitHub-derived rediscovery;
- exactly three canonical Claude logical reviews before one Codex logical
  synthesis-verification stage, with at most one fresh retry per stage;
- parallel Claude execution and sequential Codex execution;
- Claude and Codex fixed isolation arguments and neutral directories;
- protocol, angle, output-limit, timeout, termination, and child-close behavior;
- lease exclusivity, heartbeat, stale-owner reclamation, whole-run deadline, and
  retry backoff;
- one-marker lifecycle and semantic duplicate suppression;
- stale-head refusal and native `COMMENT | APPROVE` validation;
- absence of code writes, `REQUEST_CHANGES`, merge, push, and thread resolution.

Acceptance requires:

1. all repository tests and checks pass;
2. real isolated Claude and Codex smoke calls pass BRB protocol validation;
3. a fault-injection run kills a reviewer and proves the trigger is retried;
4. killing the coordinator proves a later tick reclaims its stale lease;
5. stopping the Hermes gateway proves launchd restarts it;
6. an empty live Nex tick performs no GitHub write;
7. the first real eligible Nex trigger completes only after explicit inspection
   of its marker, reviewer artifacts, native review state, and exact head SHA.
