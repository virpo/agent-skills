# 🧰 Agent Skills

Opinionated workflows forged in real projects—not a prompt dump.

## Skills

### 🔬 Look Hard

Inspect an existing user-facing artifact in its real form, improve the highest-impact problems, and prove the result with comparable before-and-after evidence.

```bash
npx skills add virpo/agent-skills --skill look-hard
```

### 🧪 Review Tube Man

Cross-review agent-written code with a different coding agent. Hunt for security failures, system-wide breakage, and deep feature regressions; prove accepted findings with tests before fixing them.

```bash
npx skills add virpo/agent-skills --skill review-tube-man
```

## Compatibility

The skills use the open Agent Skills folder format. They are designed for Codex and Claude Code, and should work in other compatible agent harnesses.

Review Tube Man expects:

- a git checkout;
- GitHub CLI when PR reporting is explicitly requested; and
- a reviewer different from the author, invoked without tools or inside a genuine external isolation boundary.

GitHub comments, code edits, pushes, review submissions, thread resolution, and merges require explicit user authorization.

## Quality bar

Every skill has a no-skill control, a fresh-agent forward test, deterministic validation where practical, and a concrete definition of proof.

## License

MIT
