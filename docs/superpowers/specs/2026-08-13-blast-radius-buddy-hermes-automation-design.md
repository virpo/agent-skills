# 🪽🧨 Automatic Blast Radius Buddy Review Design

## Goal

Allow a local Hermes installation to watch one configured GitHub repository and
run Blast Radius Buddy automatically on pull requests from one configured
author. A clean BRB result must create a native GitHub approval, not merely a
comment that says the pull request looks good.

Repository and author values are deployment configuration. They must not be
committed to this public skill repository.

## Eligibility

A pull request revision is eligible only when all of these are true:

- the pull request is open;
- its author matches the configured GitHub login exactly;
- it is marked ready for review, not draft;
- every required GitHub check has completed successfully;
- BRB has not completed a native review for the current head SHA.

A new head SHA is a new revision and becomes eligible after its required checks
pass. Pending or failing checks leave the revision queued for a later poll.

Completion is BRB-specific. An unrelated manual review by the authenticated
account must not cause the watcher to skip the revision. A stale or incomplete
BRB marker without a final native review must remain retryable.

## Architecture

Use Hermes's built-in cron scheduler with a deterministic preflight script and
the `blast-radius-buddy` skill attached.

1. The scheduler runs every ten minutes from the configured repository
   worktree.
2. The preflight script queries GitHub with `gh`, applies the eligibility rules,
   and prints a stable, machine-readable queue.
3. Empty output suppresses the Hermes agent run.
4. Non-empty output starts Hermes with BRB loaded. Hermes processes each queued
   pull request revision sequentially.
5. BRB owns the marker, independent review, validation, stale-head check, and
   final GitHub review submission.

Use a normal cron preflight script rather than Hermes monitor mode. Monitor mode
records its hash before the agent finishes, which could permanently suppress a
retry after an incomplete BRB run. A normal script runs cheaply on every tick
and can rediscover unfinished work.

The Hermes user gateway must be installed and running as a background service;
creating a cron record alone is not sufficient.

## GitHub review contract

BRB remains the sole owner of the review verdict and write boundary:

- actionable findings or material uncertainty produce native `COMMENT`;
- a failed, incomplete, or stale run produces no native review;
- BRB never produces `REQUEST_CHANGES`;
- a clean run whose approval gates all pass produces native `APPROVE`.

For the approval path, `github-review.mjs` must POST a pull-request review with
the captured current head SHA and `event: "APPROVE"`. Successful response
validation must yield the created review URL. A text body containing words such
as “approve,” “clean,” or “looks good” does not satisfy this contract unless the
native event is `APPROVE` and GitHub records the review as approved.

Immediately before the POST, BRB rechecks the pull request head. A changed head
aborts the write and leaves the new revision eligible after its checks pass.

## Idempotency and retries

The unit of work is repository, pull-request number, and exact head SHA.

- A completed BRB native review suppresses the same revision on future ticks.
- A new head SHA is reviewed independently.
- An incomplete run remains eligible and is retried on a later tick.
- Hermes's per-job execution lock prevents overlapping runs of the same watcher.
- Existing BRB history and markers prevent duplicate findings and marker spam.

The cron run history, BRB marker, and final native review make the system
observable. Failures must remain visible in the marker or Hermes run output and
must never be reported as approval.

## Scope and safety

The automation is authorized only for the configured repository and author. It
may create or update BRB's marker and submit BRB's one final native review. It
does not edit code, commit, push, merge, resolve threads, or modify pull-request
metadata.

The local deployment uses the already authenticated `gh` account. Secrets and
deployment-specific repository or author values stay outside this repository.

## Testing and verification

Implementation follows skill TDD: record a failing no-skill or pre-change
scenario, make the smallest skill/script change, then forward-test with a fresh
agent.

Automated tests cover:

- exact repository and author filtering;
- draft exclusion;
- pending, failing, and successful required-check states;
- BRB-specific completion detection at the exact head SHA;
- re-eligibility after a head change;
- retry after incomplete or stale execution;
- stable empty and non-empty queue output;
- `APPROVE` gate derivation;
- the final GitHub payload containing `event: "APPROVE"`;
- stale-head refusal immediately before submission;
- absence of `REQUEST_CHANGES`, merge, push, or code-write behavior.

End-to-end verification installs BRB into Hermes, creates the cron job, starts
the user gateway, checks scheduler status and job configuration, runs one manual
tick against a no-work state, and inspects durable run history. Live pull
requests are not fabricated solely for testing.
