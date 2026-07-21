# Blast Radius Buddy Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand `review-tube-man` as `🧨 Blast Radius Buddy` without changing its high-impact review behavior or orphaning an existing GitHub marker comment.

**Architecture:** Rename the skill, scenario, metadata, and public documentation as one identity change. Change new GitHub reports to a `blast-radius-buddy` marker while recognizing the legacy `review-tube-man` marker so an existing authenticated-user comment is updated rather than duplicated.

**Tech Stack:** Markdown, YAML, dependency-free Node.js, `node:test`

## Global Constraints

- Skill folder and frontmatter name are `blast-radius-buddy`.
- Display name is `🧨 Blast Radius Buddy`.
- Preserve the three angles, finding gate, isolated different-agent review, durable RED-GREEN repair test, and one-comment lifecycle.
- Recognize the legacy `<!-- review-tube-man -->` marker but emit only `<!-- blast-radius-buddy -->` in new bodies.
- Keep public content generic and free of private paths or material.
- Do not push without an explicit user request.

---

### Task 1: Rename the tested public identity

**Files:**
- Rename: `skills/review-tube-man/` to `skills/blast-radius-buddy/`
- Rename: `tests/review-tube-man-contract.test.mjs` to `tests/blast-radius-buddy-contract.test.mjs`
- Rename: `tests/scenarios/review-tube-man.md` to `tests/scenarios/blast-radius-buddy.md`
- Modify: `tests/skill-contracts.test.mjs`
- Modify: `tests/review-comment.test.mjs`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-20-agent-skills-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-agent-skills.md`

**Interfaces:**
- Consumes: the current `review-tube-man` skill contract and `review-comment.mjs` helper.
- Produces: `$blast-radius-buddy`, `skills/blast-radius-buddy/`, new marker emission, and legacy marker lookup.

- [x] **Step 1: Write the failing identity and compatibility tests**

Change contract paths and expected skill names to `blast-radius-buddy`. Change the primary marker expectation to `<!-- blast-radius-buddy -->`, then add a test proving `findMarkerComment()` still recognizes `<!-- review-tube-man -->`.

- [x] **Step 2: Run the tests to verify RED**

Run: `npm test`

Expected: failure because the `blast-radius-buddy` skill path and new marker do not yet exist.

- [x] **Step 3: Rename and update the skill**

Rename the directories and scenario files. Update frontmatter, heading, UI metadata, prompt invocation, report title, helper paths, marker emission, and legacy marker lookup. Preserve all review behavior.

- [x] **Step 4: Update public and design documentation**

Replace the old identity in the README, design spec, original implementation plan, and scenario. Keep the old name only where documented as a legacy marker compatibility value.

- [x] **Step 5: Run GREEN verification**

Run:

```bash
npm test
npm run check
python3 "$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py" skills/blast-radius-buddy
rg -n "review-tube-man|Review Tube Man|🧪" . -g '!node_modules'
```

Expected: all tests and validation pass. The final search finds only intentional legacy-marker compatibility references.

- [x] **Step 6: Inspect the diff**

Run: `git status --short && git diff --check && git diff --stat && git diff`

Expected: only the identity rename, compatibility test, plan, and matching documentation changes.
