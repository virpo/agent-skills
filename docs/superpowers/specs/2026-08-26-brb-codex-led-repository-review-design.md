# BRB Codex-Led Repository Review Design

## Status

This design replaces the reviewer topology, context assembly, and model-failure
rules in `2026-08-25-brb-opus-long-review-recovery-design.md`. The durable
watcher, trigger, lease, GitHub artifact, authorization, and exact-head safety
contracts from `2026-08-24-reliable-brb-automation-design.md` remain in force
unless this document changes them explicitly.

## Goal

Blast Radius Buddy must review pull requests with Codex as the primary reasoning
engine. It must inspect the exact repository revision to understand intent,
callers, contracts, tests, and blast radius instead of sending the same large
frozen packet to several tool-less reviewers. A normal run uses a Codex scope
assessment, two Codex angle reviewers, at most one Claude Opus angle reviewer,
and one fresh Codex synthesis verifier.

BRB never escalates to three Opus reviewers. Large or risky pull requests use
better targeting and repository inspection, not additional Opus calls.

## Model topology

Each run has three stages:

1. **Codex scope assessment.** One isolated Codex process inspects the exact
   pull-request checkout and trusted review artifacts. It returns a validated
   review plan containing the pull-request intent, architectural boundaries,
   risk clusters, relevant callers and tests, all changed-file dispositions,
   and the assignment of the three canonical review angles.
2. **Three-angle review.** Exactly three isolated reviewers run in parallel:
   two Codex reviewers and one Claude Opus reviewer. The scope assessment assigns
   Opus to the highest-risk canonical angle; the other two angles go to Codex.
   Every canonical angle remains covered exactly once:
   `security-and-abuse`, `system-blast-radius`, and
   `feature-truth-and-adjacent-regressions`.
3. **Codex synthesis verification.** One fresh Codex process receives the review
   plan and all three validated angle results, inspects their cited repository
   evidence, deduplicates findings, challenges reachability and severity,
   validates prior-feedback treatment and inline anchors, and emits the final
   normalized report and proposed `COMMENT` or `APPROVE` event.

The scope assessor does not produce actionable findings. Its plan guides effort
but cannot suppress an angle or make a finding authoritative. The final Codex
verifier must recheck every surviving material claim against the checkout.

Configured model identifiers are explicit deployment inputs. Codex uses
`gpt-5.6-sol`. Claude uses `opus` with `--effort medium` and prompt suggestions
disabled. There is no Sonnet, Haiku, or three-Opus fallback.

## Exact repository workspace

The deterministic coordinator creates one temporary review workspace for the
captured head SHA. It materializes a detached checkout and trusted artifacts:

- pull-request identity, title, body, base SHA, head SHA, and changed-file list;
- the complete GitHub diff as a file rather than duplicated prompt text;
- changed new-side line coordinates;
- compact prior-feedback history;
- applicable repository `AGENTS.md` rules discovered from the root toward each
  changed file.

The coordinator validates that the checkout resolves to the captured head and
stays unchanged. Model prompts contain paths to these artifacts and a concise
execution contract, not the full diff. Reviewers may inspect the diff,
surrounding source, callers, configuration, and tests inside this workspace.

The workspace exposes no GitHub write capability. Model environments omit
GitHub tokens and unrelated credentials. Codex runs ephemerally in a read-only
sandbox. Claude receives only read-only file discovery and reading tools; it
cannot edit files, execute project code, use the network, or call GitHub. The
deterministic coordinator remains the only component allowed to write GitHub
state.

Repository files and instructions are untrusted data. Only the coordinator's
prompt templates and artifacts are instructions. Repository text that asks a
reviewer to change its role, use credentials, skip files, or perform external
actions must be ignored.

## Scope assessment and coverage

The Codex scope assessment returns a strict `brb-plan` protocol with:

- a one-sentence statement of the pull request's intended behavior;
- architectural boundaries and affected runtime surfaces;
- risk clusters with changed files, relevant surrounding files, callers,
  contracts, configuration, and tests to inspect;
- a disposition for every changed file: material cluster, mechanical/generated,
  or explicitly low-risk with a concrete reason;
- one of the three canonical angles selected for Opus, with a risk-based reason;
- the remaining two angles assigned to Codex;
- known context gaps that prevent a trustworthy review.

Protocol validation requires all changed files to appear exactly once in the
coverage map and every canonical angle to be assigned exactly once. Generated,
vendored, lockfile, fixture, and mechanical churn may be grouped, but it may not
silently disappear. A context gap stops the run before reviewer dispatch.

Each angle reviewer receives the complete plan, its assigned lens, the artifact
paths, and the exact checkout. It prioritizes the scout's risk clusters but may
inspect any relevant repository file. Its output records inspected clusters,
evidence paths, and any material plan gap it discovered. A plan gap does not
invalidate a supported finding; it becomes explicit input to final synthesis.

BRB does not stop merely because prompt text would exceed the old 400,000
character packet limit. The diff and repository stay on disk for selective
inspection. If three reviewers cannot cover the plan within their bounds, the
run ends incomplete instead of adding Opus reviewers or claiming full coverage.

## Failure and timeout policy

Every logical stage has one bounded corrective retry for malformed protocol,
empty output, or a fast infrastructure failure. Retries use a fresh ephemeral
process and share the stage's total wall-clock budget; they do not restart an
entire successful wave.

- Codex scope assessment: ten-minute stage budget.
- Three-angle wave: ten-minute stage budget.
- Codex synthesis verification: ten-minute stage budget.
- Inactivity watchdog: five minutes for every process.
- Whole run: fixed 45-minute lease deadline with one-minute heartbeats.

The coordinator classifies exit, protocol, timeout, inactivity, and child
lifecycle failures separately. It terminates overdue children with `SIGTERM`,
then `SIGKILL`, and waits for close before cleaning the workspace.

A failed Codex angle is retried once as Codex. A failed Opus angle is replaced
once by a fresh Codex reviewer for the same angle and is recorded as degraded
model diversity. All three angle results must still validate before synthesis.
An exhausted angle, scope-assessment failure, or synthesis failure leaves the
trigger eligible for the existing scheduled retry. BRB never substitutes
another Claude model and never adds more Opus reviewers.

Requested reviewer failures do not discard other completed angle artifacts
inside the active run, but artifacts are bound to the exact plan, head SHA, and
trigger. A later scheduler retry starts a new assessment and does not reuse
stale model judgments.

## Verification and reporting

The final Codex verifier has read-only access to the exact checkout. It must
recheck each material finding's changed behavior, reachability, consequence,
scope, severity, and cited line. Claims that need project execution, external
systems, secrets, or runtime proof remain deferred and force `COMMENT`; the
automatic workflow does not execute untrusted project code.

The deterministic host still owns final gates:

- the scope assessment and three angle results validated;
- every changed file has a plan disposition;
- all surviving inline anchors exist on changed new-side lines;
- required checks still pass;
- the pull-request head still equals the captured SHA;
- `APPROVE` has no actionable or deferred material finding;
- the model-proposed event matches the deterministic event.

The existing one-marker lifecycle, native review, semantic duplicate
suppression, and no-`REQUEST_CHANGES` policy remain unchanged for normal
automatic runs.

## Silent supervised rollout

The first run of this topology on the selected validation pull request uses a
quiet-until-complete mode:

1. Capture the PR, create the exact workspace, and run the complete pipeline
   without creating or editing any GitHub artifact.
2. Validate the report, review payload, current checks, active GitHub account,
   and unchanged head SHA locally.
3. If any stage or gate fails, make no GitHub write and retain concise local
   diagnostics for repair.
4. If every stage and gate passes, submit the validated native review with its
   inline comments and create or update the final BRB marker. Recheck the head
   SHA immediately at the write boundary.

Quiet-until-complete is a supervised rollout option, not the automatic watcher
default. Future automatic triggers post the working marker before model work so
authors can see that BRB owns the review.

## Observability

Structured logs record the trigger, exact head, workspace lifecycle, plan
coverage counts, model assigned to each angle, attempt number, elapsed time,
failure classification, final event, and GitHub URLs. Logs never contain the
diff, source contents, model output, credentials, or full prompts.

The final marker's collapsed run details identify the effective mix, including
an Opus-to-Codex replacement, without exposing internal reasoning.

## Testing and acceptance

Implementation is test-first and adds no dependency. Tests cover:

- exact detached-head workspace creation, nested `AGENTS.md` discovery,
  read-only cleanliness checks, and cleanup;
- strict `brb-plan` parsing, complete changed-file disposition, three unique
  angle assignments, and exactly zero or one Opus assignment;
- one scope-assessment Codex stage before the parallel reviewer wave;
- exactly two Codex plus one Opus reviewer in the healthy path;
- risk-based Opus assignment and two Codex assignments;
- explicit Opus medium effort, disabled prompt suggestions, and read-only tools;
- Codex read-only checkout access with ignored user configuration;
- bounded stage retries and Opus-to-Codex replacement without additional Opus;
- synthesis only after three validated angles;
- final evidence, anchor, check, event, and unchanged-head gates;
- quiet-until-complete producing zero GitHub writes on any failure;
- quiet-until-complete publishing one final marker and native review only after
  every local and write-boundary gate passes;
- automatic mode retaining its working, retry, incomplete, stale, and final
  marker lifecycle;
- absence of code execution, edits, commits, pushes, merges, thread resolution,
  `REQUEST_CHANGES`, and unbounded model escalation.

Acceptance requires:

1. `npm test` and `npm run check` pass.
2. Isolated live smoke calls prove Codex can inspect the read-only checkout and
   Claude Opus medium can use only the allowed read tools.
3. Fault injection proves an Opus failure produces one Codex replacement and
   never another Opus.
4. A silent full run on the validation PR produces no GitHub write.
5. The silent result is inspected for exact head, coverage, findings, anchors,
   proposed event, account, and payload.
6. Only a fully valid result is published to the validation PR.
7. The installed watcher is updated and a no-work tick proves the durable
   automatic path still runs without a GitHub write.
