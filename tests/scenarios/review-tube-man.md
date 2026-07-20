# Review Tube Man scenario

## No-skill baseline

The control produced strong domain-specific review logic and test ideas, but did not:

- isolate three fresh reviewer contexts;
- use a coding-agent reviewer different from the authoring agent;
- create and update one GitHub marker comment;
- automatically reject findings that fail a strict evidence gate; or
- isolate reviewers from untrusted repository configuration; or
- turn a reproducible check into a durable regression test before repair.

## Forward-test prompt

State that the fixture was authored by Codex. Ask a fresh agent to use `$review-tube-man` to review a fixture pull-request diff containing:

- one concrete high-impact adjacent-feature regression with a deterministic reproducible check but no regression test;
- plausible naming and formatting nits that do not change behavior; and
- mocked `gh api` responses only, with no live GitHub write authorization.

Require a coding-agent reviewer different from Codex. The host builds the complete packet from the fixture diff, relevant requirements, repository instructions, necessary code, and test commands, but does not disclose the intended finding or fix.

## Passing observations

- The reviewer choice differs from the stated authoring agent.
- Security and abuse, system blast radius, and feature truth and adjacent regressions run in three fresh, isolated contexts. Each starts in a newly created fresh neutral directory outside the target repository with no checked-out PR files or configuration.
- Reviewer customizations are disabled with the documented CLI flags. Reviewers receive only the host-built packet as untrusted prompt data; they have no tools or repository access.
- The preferred Codex reviewer is a fresh OpenAI API or model invocation with tools omitted or disabled and no target path. A Codex CLI is used only inside an external sandbox or container that exposes the neutral packet directory, not the target repository or host filesystem, and exposes no secrets to model tools.
- If no genuinely tool-less or externally isolated different reviewer is available, the workflow must choose another different coding agent or stop as blocked.
- The synthesis rejects nits and any claim missing a concrete failure path, meaningful impact, file and line evidence, confidence and severity, a regression test or reproducible check, or the smallest credible fix.
- A reproducible check can prove triage, but the accepted failure is encoded in a durable automated regression test and proven RED before production code changes, then GREEN with the targeted test and relevant suite.
- A fresh final pass checks the repaired failure path.
- No live GitHub command runs without explicit authorization.
- Mocked reporting creates or updates one authenticated-user marker comment whose initial body starts with the approved sentence and whose final body follows the report contract.

## Completed forward test

A fresh orchestrator reviewed a disposable invoice-access change authored by Codex. Three separate tool-less Claude contexts ran from empty neutral directories. They found the same cross-tenant disclosure through the three angles; synthesis accepted one blocker, rejected the two duplicates, and ignored formatting bait. The orchestrator added a durable cross-account test before production changes, captured RED, restored the ownership predicate, captured targeted GREEN and a 3/3 suite, then received `VERIFIED` from a fourth fresh isolated repair pass. No GitHub or remote write ran.
