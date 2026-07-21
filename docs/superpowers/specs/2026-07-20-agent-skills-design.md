# 🧰 Agent Skills Design

## Goal

Create a public `virpo/agent-skills` repository for judgment-heavy workflows distilled from repeated real projects. The first release contains `look-hard` and `blast-radius-buddy`.

## Product shape

This is not a prompt dump. Each skill must own a recognizable task, an observable result, and a failure mode that capable agents still routinely miss.

- `🔬 look-hard` improves an existing user-facing artifact by inspecting its real rendered or physical form, applying an opinionated refinement rubric, iterating, and proving the result.
- `🧨 blast-radius-buddy` cross-reviews agent-written code with a different coding agent, hunts only high-impact failures, proves accepted findings with tests or reproducible checks, fixes authorized findings, and maintains one GitHub review comment from start to finish.

The repository identity is `🧰 Agent Skills`.

## Repository architecture

```text
agent-skills/
  README.md
  AGENTS.md
  LICENSE
  package.json
  skills/
    look-hard/
      SKILL.md
      agents/openai.yaml
      references/refinement-principles.md
      references/proof-matrix.md
    blast-radius-buddy/
      SKILL.md
      agents/openai.yaml
      references/review-angles.md
      references/reviewer-prompts.md
      references/github-report.md
      scripts/review-comment.mjs
  tests/
    skill-contracts.test.mjs
    review-comment.test.mjs
    scenarios/
  docs/superpowers/
```

The skills follow the open Agent Skills folder format. Detailed judgment lives in references so `SKILL.md` remains concise. The repository uses dependency-free Node.js tests and scripts.

## `look-hard`

### Trigger boundary

Use when someone asks an agent to inspect, critique, polish, improve, finish, or compare an existing user-facing artifact and quality depends on seeing the real thing. Artifacts include interfaces, decks, documents, rendered media, device output, and physical designs.

Do not use for greenfield ideation, pure research, or code-only debugging. Review-only use is valid: inspect and rank findings, then name the proof a changed artifact would need without implying that an after state exists.

### Workflow

1. Resolve the exact artifact, current state, intended audience, and north star.
2. Capture a before state in the correct medium.
3. Inspect the real output, including meaningful states and sizes.
4. Separate findings into broken, confusing, generic or emotionally flat, and unfinished.
5. Rank a small set of high-leverage changes.
6. Edit only when authorized.
7. Re-render or recapture under equivalent conditions.
8. Compare before and after, check important variants, and repeat while material issues remain.
9. Report proof and unresolved gaps without claiming quality that was not observed.

### Refinement judgment

The public rubric distills Peter's repeated corrections without exposing private projects:

- Real output beats source-code inference.
- The artifact must communicate its primary state, hierarchy, and next action immediately.
- Spacing, alignment, density, rhythm, contrast, and copy are functional quality.
- Remove wrappers, duplicate labels, decorative structure, and competing actions before adding ornament.
- Prefer one strong visual or interaction idea over generic polish.
- Readability beats cleverness; mobile, dark mode, waiting, empty, error, selected, and disabled states remain unmistakable.
- A useful surprise should reveal understanding or save work, not bolt on gamification.
- Sharp, concrete language beats corporate or AI-generated filler.
- Before and after evidence must use comparable conditions.

## `blast-radius-buddy`

> Superseded for PR-review behavior by [the 2026-07-22 Blast Radius Buddy PR review design](2026-07-22-blast-radius-buddy-pr-review-design.md).

### Trigger boundary

Use when a pull request or branch was substantially written by a coding agent and the user wants a fresh, high-impact review from a different coding agent. The user must explicitly authorize GitHub comments, code changes, pushes, or thread resolution.

### Three independent angles

1. **Security and abuse**
   - Authentication and authorization boundaries.
   - Injection, unsafe parsing, secrets, data exposure, privilege escalation, confused-deputy behavior, dependency and supply-chain risk.

2. **System blast radius**
   - Data loss or corruption, concurrency, migrations, shared-path regressions, performance cliffs, resource exhaustion, startup or deploy failures, rollback safety, dependency failure, and observability gaps that hide a major outage.

3. **Feature truth**
   - Domain invariants, state transitions, edge cases, retries and idempotency, backwards compatibility, adjacent-feature behavior, and whether the implementation actually satisfies the intended user contract.

Code style, naming, formatting, optional abstractions, and speculative architecture are out of scope unless they create a concrete high-impact failure path.

### Finding gate

A finding survives only when it includes:

- a concrete execution or attack path;
- meaningful impact;
- file and line evidence;
- confidence and severity;
- a regression test or reproducible check;
- the smallest credible fix.

One real failure with proof is more valuable than twenty possible concerns. Duplicate or speculative findings are rejected during synthesis.

### Review and repair loop

1. Resolve the PR, repository instructions, base and head revisions, relevant requirements, and test commands.
2. If GitHub reporting is explicitly authorized, create one marker comment beginning with `I am going to review this. I will update this comment with findings.`
3. Build a bounded review packet containing the diff plus only the surrounding code and requirements needed to evaluate it.
4. Select a reviewer different from the authoring agent. Default Codex-authored work to Claude and Claude-authored work to Codex; accept an explicit reviewer override.
5. Run the three angles in fresh contexts. Reviewers return structured findings only.
6. Synthesize and deduplicate. Reject nits and unsupported speculation.
7. For each accepted finding authorized for repair, write a failing regression test or deterministic reproduction first and run it to prove the failure.
8. Apply the smallest fix, rerun the targeted test, then the relevant suite.
9. Run one fresh final pass over the repaired diff for the accepted failure paths.
10. Update the same GitHub comment with verdict, accepted findings, evidence, fixes, exact tests, revision, residual risks, and suggestions for anything left unresolved.

The skill comments; it does not automatically approve, request changes, resolve threads, push, or merge unless the user explicitly asks.

## GitHub comment contract

The helper script uses a stable hidden marker to find the workflow's comment and updates it rather than posting progress spam.

The final report is short and evidence-led:

- verdict: blocking findings, repaired findings, or no high-impact findings;
- three-angle coverage;
- each accepted finding's failure path and impact;
- regression test or reproduction result;
- fix status and exact verification command;
- unresolved risk and suggested change when applicable.

## Testing

Each skill is developed with a no-skill baseline and a with-skill forward test.

- `look-hard` must cause an agent to inspect actual output, preserve a before state, rank changes, verify meaningful variants, and refuse unsupported readiness claims.
- `blast-radius-buddy` must ignore plausible nits, preserve angle isolation, require the finding gate, demonstrate red-green repair, and update one comment rather than posting several.
- The helper script receives mocked `gh` responses in unit tests; tests never write to a real GitHub repository.
- A repository contract test validates frontmatter, names, required metadata, public-safe paths, and the absence of private source material.

## Publication

Create a clean `main` history, MIT license, and public `virpo/agent-skills` repository. Verify anonymous GitHub visibility and the documented installation commands after push.
