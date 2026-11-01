# 🧰 Agent Skills

Opinionated workflows forged in real projects—not a prompt dump.

## Skills

### 🔬 Look Hard

Inspect an existing user-facing artifact in its real form, improve the highest-impact problems, and prove the result with comparable before-and-after evidence.

```bash
npx skills add virpo/agent-skills --skill look-hard
```

### 🧨 Blast Radius Buddy

Review a GitHub pull request through security, system blast-radius, and feature-truth angles. Validate consequential findings with a host-selected diagnostic in an isolated checkout plus tool-less classification, ignore nits, and submit a gate-derived native comment or approval without changing the branch. A correct PR may still receive approval with up to three evidence-backed, non-blocking suggestions.

Blast Radius Buddy keeps every prior review visible. Cross-run duplicates require host semantic judgment over the complete ledger; run-local IDs and review-linkage fingerprints never suppress another review automatically.

```bash
npx skills add virpo/agent-skills --skill blast-radius-buddy
```

### 🏷️ Sell My Stuff

Point an agent at a folder of photos of things you don't use. It groups the photos into items, identifies each one, researches comparable prices, writes honest listings, and opens one small review page where you adjust prices. After you approve, it posts to the marketplaces you pick (Facebook Marketplace, Craigslist, eBay, Vinted, Bazoš, Kleinanzeigen and others) in a visible browser while you handle logins.

```bash
npx skills add virpo/agent-skills --skill sell-my-stuff
```

Sell My Stuff expects a vision-capable agent, web search, Node for the review page, and a browser tool that can upload files for posting. Without a browser tool it prepares copy-ready listings instead.

### 📖 Infinite Book Explainer

Turn one subject (a jet, a locomotive, a castle, a whale) into a living children's encyclopedia page. A huge hand-painted cross-section plate is clickable, and the camera flies into any part. Every deeper level is an image-model repaint of the exact area above it, aligned back so you zoom into the same picture. "How it works" spreads turn out of the painting into diagrams whose parts really move, with watercolour airflow, self-drawing ink arrows and levers a child can pull. The skill ships as a static site, with optional frame-exact video capture.

```bash
npx skills add virpo/agent-skills --skill infinite-book-explainer
```

Infinite Book Explainer expects an image model with generation and image-edit modes (the Codex CLI's built-in image tool works), Python 3 with Pillow, NumPy, SciPy and scikit-image, and a browser the agent can drive.

## Compatibility

The skills use the open Agent Skills folder format. They are designed for Codex and Claude Code, and should work in other compatible agent harnesses.

Blast Radius Buddy expects:

- an explicit manual invocation for a PR URL, number, or current branch;
- `gh` installed and authenticated for the target GitHub repository; and
- an isolated reviewer that can run fresh contexts without target-repository access or tools.

Manual invocation authorizes one marker comment and one final native review. It does not authorize code edits, commits, pushes, `REQUEST_CHANGES`, thread resolution, or merges.

## Quality bar

Every skill has a no-skill control, a fresh-agent forward test, deterministic validation where practical, and a concrete definition of proof.

## License

MIT
