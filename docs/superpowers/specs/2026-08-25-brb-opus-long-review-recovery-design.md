# BRB Opus Long-Review Recovery Design

## Objective

Blast Radius Buddy must complete consequential reviews of large pull requests without reducing coverage. Each run uses exactly three isolated Claude Opus first-pass reviewers, followed by one Codex `gpt-5.6-sol` synthesis and verification pass. A large, healthy run may take 20–30 minutes or longer; a genuinely stalled process must still recover within minutes.

## Non-goals

- Do not split or summarize away any part of a pull request diff that fits the existing 400,000-character packet limit.
- Do not replace Opus with Sonnet, Haiku, or an inherited user default.
- Do not add model fallback, partial-angle completion, extra review artifacts, or relaxed approval gates.
- Do not change BRB's authorization boundary: one marker comment and one final native review per validated trigger.

## Model topology

The deployment explicitly passes `opus` to all three Claude launchers. The security-and-abuse, system-blast-radius, and feature-truth-and-adjacent-regressions reviewers remain fresh, isolated, tool-less processes that each receive the complete bounded packet. Their validated results are passed to one isolated Codex `gpt-5.6-sol` synthesis and verification process.

Model identifiers are deployment inputs but fail closed. Missing, empty, unavailable, or rejected model identifiers stop the run. BRB never silently falls back to another model family or reuses a partial result from an earlier run.

## Activity-aware reviewer lifecycle

Claude runs in streaming JSON mode with partial messages enabled. The launcher assembles the final assistant text for the existing protocol parser while separately tracking child activity. Model content stays local and is never copied into progress comments or logs.

Each Opus attempt has two independent bounds:

- A 25-minute hard deadline limits total attempt duration.
- A five-minute inactivity watchdog treats a child with no stdout or stderr activity as stalled.

Either bound terminates the complete child process using the existing `SIGTERM` then `SIGKILL` lifecycle. A timeout, stall, or invalid protocol response is retryable exactly once with a fresh process and the same complete packet. Exhausting the retry makes the run incomplete.

Codex keeps the same isolation and protocol validation with a 15-minute hard deadline and five-minute inactivity watchdog. It also receives one fresh retry. These limits allow the worst valid sequence—parallel Opus attempts and retries, followed by Codex attempts and retries—to fit within the whole-run lease.

## Whole-run state and recovery

The whole-run lease increases from 30 to 90 minutes. This is a fixed safety ceiling, not a target duration. The coordinator emits a lease heartbeat every minute while it owns a trigger; heartbeats update observability but never extend the original deadline.

Recovery behavior remains deterministic:

- A dead owner is reclaimable on the next scheduler tick.
- An expired whole-run lease is reclaimable even if the recorded PID still appears alive.
- A silent live reviewer is killed after five minutes and retried once.
- Sleep or restart cannot leave a permanent owner: paused timers resume on wake, and a dead process is reclaimed by the scheduler.
- Exhausted runs use the existing 5, 15, 30, then 60-minute backoff and remain eligible.

The production scheduler continues running every five minutes, so restart and dead-owner recovery happen within one scheduler interval after the machine is available.

## GitHub marker and review safety

The marker lifecycle does not change. BRB posts or updates the single working marker before model work. Internal attempt retries do not create additional GitHub comments or expose stage narration.

Every stopped, stale, or exhausted run replaces the working marker with the existing exact stopped/retry state and submits no native review. A successful run still rechecks the exact head SHA immediately before submission. Findings, uncertainty, CI gates, and approval rules remain unchanged.

## Configuration

The coordinator owns explicit runtime settings for:

- Claude model: `opus`
- Codex model: `gpt-5.6-sol`
- Opus hard timeout: 25 minutes
- Codex hard timeout: 15 minutes
- Inactivity timeout: five minutes
- Whole-run lease: 90 minutes
- Lease heartbeat interval: one minute

The installed watcher passes the model identifiers explicitly. Timing defaults live in the BRB implementation so manual and automatic runs use the same behavior unless a test dependency overrides them.

## Observability

Structured coordinator logs record the trigger, stage, attempt number, model family, start, completion, retry category, last-activity age, and terminal state. Logs never include prompts, diffs, model output, credentials, or repository content.

The durable lease exposes `startedAt`, fixed `deadlineAt`, and current `heartbeatAt`. Existing retry state remains the source of truth for backoff and next eligibility.

## Testing

Tests use deterministic fake children and clocks; they do not call live models.

Reviewer-runner coverage must prove:

- Claude receives the explicit `opus` model and streaming isolation flags.
- Stream events reset the inactivity watchdog and assemble the final protocol text exactly.
- Five minutes of silence terminates the child and triggers one fresh retry.
- Continuous activity cannot bypass the 25-minute Opus or 15-minute Codex hard deadline.
- Invalid, truncated, oversized, or duplicate protocol output still fails closed.
- Child termination waits for process exit and preserves the existing unterminated-child guard.

Coordinator and run-state coverage must prove:

- Exactly three Opus angles run in parallel before Codex.
- A one-minute heartbeat continues during long active stages without extending the deadline.
- The 90-minute deadline aborts outstanding children, clears the working marker, records backoff, and releases the lease.
- Dead-owner, sleep/wake-equivalent, and expired-lease paths remain reclaimable.
- No failure path submits a native review or leaves the marker working.

The full repository test and check commands must pass before deployment. A supervised live run on a large draft pull request then verifies the actual three-Opus-plus-Codex path, marker lifecycle, exact-head gate, and final native review.

## Rollout

Deploy the runner, coordinator, state, tests, skill documentation, and watcher model change together. Keep the existing automatic job schedule and repository scope. After the supervised large-PR run completes, inspect the final marker, native review, structured logs, durable state cleanup, and active GitHub account before treating the deployment as verified.
