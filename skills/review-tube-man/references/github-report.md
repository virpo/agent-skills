# GitHub report contract

GitHub comments are external writes. Use this path only after the user explicitly authorizes a PR comment.

## One-comment lifecycle

1. Create a local start-body file containing exactly:

```markdown
I am going to review this. I will update this comment with findings.

<!-- review-tube-man -->
```

2. Explicitly run:

```bash
node skills/review-tube-man/scripts/review-comment.mjs write --repo OWNER/REPO --pr NUMBER --body-file START.md
```

3. Replace the local file with the final report below, preserving the marker, then run the same `write` command. The helper finds only the authenticated user's marker comment and updates it; otherwise it creates one.

Never call the helper merely because the skill was invoked. Never post separate progress comments.

## Final body

```markdown
# 🧪 Review Tube Man

**Verdict:** Blocking findings | Repaired findings | No high-impact findings
**Revision:** BASE..HEAD

## Coverage

- Security and abuse: result
- System blast radius: result
- Feature truth and adjacent regressions: result

## Accepted findings

### [severity / confidence] Failure title

- Failure path: trigger through outcome
- Impact: meaningful consequence
- Evidence: `path:line` and behavior
- Triage proof: exact regression test or reproducible check and result
- Repair regression: durable automated test path, name, and RED result; required when repaired
- Fix: status and smallest repair, or suggested repair when unauthorized

## Verification

- Targeted durable regression: `command` — GREEN result
- Relevant suite: `command` — result
- Fresh repair pass: result

## Residual risk

Concrete unresolved risk, or `None observed within the bounded review.`

<!-- review-tube-man -->
```

Omit the accepted-findings subsection only when none survive the gate. Do not add a suggestions section for rejected nits.
