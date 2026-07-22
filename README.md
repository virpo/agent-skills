# 🧰 Agent Skills

Opinionated workflows forged in real projects—not a prompt dump.

## Skills

### 🔬 Look Hard

Inspect an existing user-facing artifact in its real form, improve the highest-impact problems, and prove the result with comparable before-and-after evidence.

```bash
npx skills add virpo/agent-skills --skill look-hard
```

### 🧨 Blast Radius Buddy

Review a GitHub pull request through security, system blast-radius, and feature-truth angles. Validate consequential findings, ignore nits, and submit a native comment or approval without changing the branch.

```bash
npx skills add virpo/agent-skills --skill blast-radius-buddy
```

## Compatibility

The skills use the open Agent Skills folder format. They are designed for Codex and Claude Code, and should work in other compatible agent harnesses.

Blast Radius Buddy expects:

- an explicit manual invocation for a PR URL, number, or current branch;
- `gh` installed and authenticated for the target GitHub repository; and
- an isolated reviewer that can run fresh contexts without target-repository access or tools.

Manual invocation authorizes one marker comment and one final native review. It does not authorize code edits, pushes, `REQUEST_CHANGES`, thread resolution, or merges.

## Quality bar

Every skill has a no-skill control, a fresh-agent forward test, deterministic validation where practical, and a concrete definition of proof.

## License

MIT
