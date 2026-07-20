---
name: look-hard
description: Use when a user asks to inspect, critique, polish, improve, finish, or compare an existing user-facing artifact and quality depends on seeing its real rendered, device, or physical output; applies to interfaces, decks, documents, media, device states, and physical designs, but not greenfield ideation, pure research, or code-only debugging.
---

# Look Hard

## Overview

Treat quality as an observable loop, not a source-code claim. Inspect the real artifact, preserve what already works, make a few high-leverage improvements, and prove the result under comparable conditions.

## Load the judgment

- Read `references/refinement-principles.md` whenever visual hierarchy, interaction, wording, density, tone, or taste matters.
- Read the matching route in `references/proof-matrix.md` before deciding what counts as proof.

## Workflow

1. **Resolve the target.** Name the exact artifact, audience, current state, intended feeling, hard constraints, and strongest available north star. Do not silently substitute a mockup, source file, or adjacent screen.
2. **Capture before.** Open, render, run, photograph, or otherwise observe the current artifact in its real medium. Preserve comparable evidence.
3. **Inspect meaningful variants.** Choose states, sizes, pages, environments, or physical conditions that could change the verdict. Verify identity before trusting a recent screenshot.
4. **Classify findings.** Use four buckets: broken, confusing, generic or emotionally flat, and unfinished. Tie every finding to visible evidence and user impact.
5. **Rank the pass.** Select the smallest set of changes with the largest effect. Protect deliberate choices and locked decisions. Prefer subtraction and clearer hierarchy before ornament.
6. **Respect authorization.** If the user requested review only, stop at findings. If changes are authorized, edit the artifact and its behavior or API documentation when relevant.
7. **Capture after when changed.** Reproduce the before conditions. Run the relevant functional checks, then inspect the output instead of inferring success from passing tests. For review-only work, state that after evidence is not applicable and name the proof a changed artifact would need.
8. **Compare and decide.** When changes were made, state what improved, what regressed, and what remains. Repeat while material issues remain and another pass is authorized.
9. **Report honestly.** Give the before evidence, ranked changes, after evidence, verification, and unresolved proof gaps. Never call an unseen state polished or ready.

## Output contract

Return or produce these parts in order:

1. `Target and north star`
2. `Before evidence`
3. `Ranked findings`
4. `Changes made` or `Review only`
5. `After evidence and checks` or `Not applicable — review only`, followed by required proof
6. `Verdict: pass, repeat, or blocked`

## Stop conditions

Stop and name the missing proof when the real artifact cannot be opened, the reference is ambiguous, the required device or physical test is unavailable, or a destructive/external action lacks authorization. A partial verdict is better than confident theater.
