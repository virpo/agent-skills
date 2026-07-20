# Agent Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `🧰 Agent Skills` with tested `look-hard` and `review-tube-man` skills.

**Architecture:** Keep each skill self-contained under `skills/`, with concise workflow instructions and selectively loaded references. Use dependency-free Node.js contracts and a small tested GitHub-comment helper; keep cross-agent review orchestration in the skill so reviewer CLIs can evolve independently.

**Tech Stack:** Agent Skills format, Markdown, YAML, Node.js 24, Node's built-in test runner, GitHub CLI, Codex CLI, Claude Code CLI.

## Global Constraints

- Public identity: `🧰 Agent Skills`.
- Repository: public `virpo/agent-skills` with MIT license.
- Skills: `look-hard` and `review-tube-man` only in version one.
- Every skill includes valid `SKILL.md` and `agents/openai.yaml`.
- Public content contains no private paths, source artifacts, employer-specific material, personal health/family/legal detail, tokens, or copied conversation logs.
- `look-hard` carries Peter's distilled refinement judgment while remaining useful to other people.
- `review-tube-man` reports only high-impact security, system-blast-radius, and feature-truth findings.
- No GitHub write, code edit, push, review submission, thread resolution, or merge occurs without explicit authorization.
- A repair requires a failing regression test or deterministic reproduction before the fix.
- One GitHub marker comment is updated in place.
- Node scripts have no third-party runtime dependencies.
- Commits use Conventional Commits and contain no AI attribution.

---

### Task 1: Create the public repository foundation and contract tests

**Files:**
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `LICENSE`
- Create: `README.md`
- Create: `AGENTS.md`
- Create: `package.json`
- Create: `tests/skill-contracts.test.mjs`

**Interfaces:**
- `npm test` runs every repository and script test.
- Contract tests scan `skills/*/SKILL.md` and `skills/*/agents/openai.yaml`.

- [ ] **Step 1: Write the failing repository contract test**

The test must fail while no skills exist. It asserts exactly two skill directories, lowercase hyphenated names, matching YAML `name`, descriptions beginning with `Use when`, quoted strings in `openai.yaml`, a `$skill-name` default prompt, no `TODO` or `TBD`, and no user-home paths, tokens, or raw-log handles. Run a local private-name scan before publication without committing that private vocabulary.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/skill-contracts.test.mjs`

Expected: failure reporting missing `look-hard` and `review-tube-man` directories.

- [ ] **Step 3: Create the repository foundation**

Use Node `24` in `.nvmrc`. Set `package.json` to private, ESM, and scripts `test: node --test` and `check: npm test`. Add `.worktrees/`, `node_modules/`, `.tmp/`, and `.DS_Store` to `.gitignore`. Write a concise README with the two skill promises, `npx skills add virpo/agent-skills --skill <name>`, compatibility, safety, and license. Write repo `AGENTS.md` requiring skill TDD, public-safety checks, concise instructions, and fresh-agent forward tests.

- [ ] **Step 4: Commit**

```bash
git add .gitignore .nvmrc LICENSE README.md AGENTS.md package.json tests/skill-contracts.test.mjs docs
git commit -m "chore: initialize agent skills repository"
```

---

### Task 2: Build and forward-test `look-hard`

**Files:**
- Create: `skills/look-hard/SKILL.md`
- Create: `skills/look-hard/agents/openai.yaml`
- Create: `skills/look-hard/references/refinement-principles.md`
- Create: `skills/look-hard/references/proof-matrix.md`
- Create: `tests/scenarios/look-hard.md`

**Interfaces:**
- Skill name: `look-hard`.
- Display name: `🔬 Look Hard`.
- Default prompt explicitly mentions `$look-hard`.

- [ ] **Step 1: Save the no-skill baseline**

Record only reusable failures and successes from the baseline scenario in `tests/scenarios/look-hard.md`: the control correctly inspected many states and demanded real evidence, but the public skill must make before capture, issue classification, comparable after capture, variant selection, and the repeat-or-stop decision explicit without relying on Peter's private global instructions.

- [ ] **Step 2: Create the skill with the system initializer**

```bash
python3 "$HOME/.codex/skills/.system/skill-creator/scripts/init_skill.py" look-hard --path skills --resources references --interface 'display_name=🔬 Look Hard' --interface 'short_description=Inspect, refine, and prove real artifacts' --interface 'default_prompt=Use $look-hard to inspect this artifact, improve the highest-impact issues, and prove the result.'
```

- [ ] **Step 3: Write the minimal skill and references**

Keep `SKILL.md` below 500 words. Put the workflow and stop conditions there. Put Peter's public refinement judgment in `references/refinement-principles.md`. Put artifact-specific proof routes for UI, deck, document/PDF, device, and physical objects in `references/proof-matrix.md`.

- [ ] **Step 4: Validate and run GREEN forward tests**

```bash
python3 "$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py" skills/look-hard
npm test
```

Use a fresh agent on an existing UI or deck with `$look-hard`. Verify it captures before evidence, inspects the correct surface, ranks issues, compares after evidence, checks meaningful states, and states missing proof honestly.

- [ ] **Step 5: Commit**

```bash
git add skills/look-hard tests/scenarios/look-hard.md
git commit -m "feat: add look hard refinement skill"
```

---

### Task 3: Build and forward-test `review-tube-man`

**Files:**
- Create: `skills/review-tube-man/SKILL.md`
- Create: `skills/review-tube-man/agents/openai.yaml`
- Create: `skills/review-tube-man/references/review-angles.md`
- Create: `skills/review-tube-man/references/reviewer-prompts.md`
- Create: `skills/review-tube-man/references/github-report.md`
- Create: `skills/review-tube-man/scripts/review-comment.mjs`
- Create: `tests/review-comment.test.mjs`
- Create: `tests/scenarios/review-tube-man.md`

**Interfaces:**
- Skill name: `review-tube-man`.
- Display name: `🧪 Review Tube Man`.
- The comment helper exports `findMarkerComment(comments)`, `buildStartBody()`, and `upsertReviewComment({ repo, pr, bodyFile, execute })`.
- Hidden marker: `<!-- review-tube-man -->`.

- [ ] **Step 1: Save the no-skill baseline**

Record that the control produced strong domain-specific review logic and test ideas, but did not isolate three fresh reviewer contexts, use a different authoring agent, create and update one GitHub marker comment, automatically gate findings, or execute the red-green repair loop.

- [ ] **Step 2: Write and verify failing comment-helper tests**

Tests cover marker detection, exact start copy, update of an existing comment, creation when absent, safe argument passing, and dry execution through a supplied fake `execute` function. Run `node --test tests/review-comment.test.mjs`; expect missing-module failure.

- [ ] **Step 3: Create the skill with the system initializer**

```bash
python3 "$HOME/.codex/skills/.system/skill-creator/scripts/init_skill.py" review-tube-man --path skills --resources scripts,references --interface 'display_name=🧪 Review Tube Man' --interface 'short_description=Cross-agent review for system-breaking bugs' --interface 'default_prompt=Use $review-tube-man to review this PR for high-impact failures with a different coding agent.'
```

- [ ] **Step 4: Implement the helper and skill**

Implement the helper without shell interpolation. It must invoke `gh api` through argument arrays, find the authenticated user's existing marker comment, and create or patch one issue comment. GitHub writes require an explicit command path from the skill. Put angle rubrics, structured finding contract, reviewer CLI prompt patterns, and final report template in references.

- [ ] **Step 5: Run tests and skill validation**

```bash
node --test tests/review-comment.test.mjs
python3 "$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py" skills/review-tube-man
npm test
```

- [ ] **Step 6: Run GREEN forward tests without live GitHub writes**

Use a fresh agent on a fixture diff with `$review-tube-man`, mocked GitHub commands, and a reviewer CLI different from the stated author. Verify three isolated angles, rejection of nits, concrete impact and evidence, a failing test before repair, targeted and relevant-suite verification, and one updated report.

- [ ] **Step 7: Commit**

```bash
git add skills/review-tube-man tests/review-comment.test.mjs tests/scenarios/review-tube-man.md
git commit -m "feat: add review tube man skill"
```

---

### Task 4: Review, publish, and verify

**Files:**
- Modify as findings require: public repository files only.

**Interfaces:**
- Produces public `https://github.com/virpo/agent-skills` on `main`.

- [ ] **Step 1: Run complete verification**

```bash
npm test
npm run check
git status --short
rg -n '/Users/|codex:' README.md AGENTS.md skills tests
```

Expected: tests pass; source scan has no private references except intentional generic mentions of Codex as a product.

- [ ] **Step 2: Request a fresh whole-repository review**

Review skill triggers, public safety, instruction concision, finding-gate rigor, GitHub write safeguards, test quality, and README installation commands. Fix every Critical or Important finding and rerun verification.

- [ ] **Step 3: Create and push the public repository**

```bash
gh auth switch --hostname github.com --user virpo
gh repo create virpo/agent-skills --public --source . --remote origin --push --description "🧰 Opinionated agent skills forged in real projects"
```

- [ ] **Step 4: Verify public state**

```bash
gh repo view virpo/agent-skills --json nameWithOwner,visibility,url,defaultBranchRef
git ls-remote --heads origin
curl -sS https://api.github.com/repos/virpo/agent-skills
```

Expected: visibility `PUBLIC`, default branch `main`, `refs/heads/main` present, and anonymous API response contains `"private": false`.
