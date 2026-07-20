# Agent Skills

This is the public `🧰 Agent Skills` repository.

## Rules

- Follow the open Agent Skills folder format under `skills/<name>/`.
- Use lowercase hyphenated skill names.
- Keep `SKILL.md` concise; move detailed judgment to one-level `references/` files.
- Descriptions begin with `Use when` and contain trigger conditions, not a workflow summary.
- Create skills test-first: run a no-skill control, record the actual gap, write the minimal skill, then forward-test with a fresh agent.
- Run the system skill validator and `npm test` before committing.
- Keep public material generic and source-faithful. Never include private paths, logs, tokens, employer material, personal records, or private project details.
- External writes require explicit user authorization.
- Prefer one proven, high-impact finding over a long list of speculative concerns.
- Commits use Conventional Commits. Do not add AI attribution.

## Required checks

```bash
npm test
npm run check
```
