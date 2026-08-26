# BRB linked finding summary design

## Goal

Make every actionable BRB native review immediately scannable from its root body.
The opening should contain one compact bullet per finding with its severity, title,
and exact inline discussion link when GitHub provides one.

Example:

```md
3 things need another pass.

- **Medium** — [Update review hides the workflow being overwritten](https://github.com/acme/widget/pull/19#discussion_r123)
- **High** — [Workflow enrichment failures prevent transcript loading](https://github.com/acme/widget/pull/19#discussion_r124)
```

Clean approvals keep their existing single-line conclusion. Non-blocking suggestions
are not added to this finding list.

## Rendering

The prepared review body contains the same compact list before submission, using
plain titles because GitHub has not assigned inline comment URLs yet. Existing
full details for findings without safe inline anchors remain below the list.

After GitHub creates the native review, BRB reads only that review's inline
comments. It maps each comment to its finding through the existing stable hidden
finding marker, rebuilds the same root body with exact `html_url` links, and
updates that same native review. Findings without safe inline anchors remain
plain list items annotated with `details below`; BRB never invents a discussion
link or weakens anchor validation.

## Safety and recovery

- Reauthorize the lease, exact head, and GitHub identity immediately before the
  review-body update, as for every other write boundary.
- Accept only GitHub comment URLs returned for the newly created review and only
  markers matching the normalized report.
- Keep the hidden review metadata byte-for-byte equivalent apart from the normal
  deterministic escaping performed by the renderer.
- The initial POST already contains the useful unlinked summary. If comment lookup
  or the follow-up update fails after the review exists, do not retry the whole
  review or create a duplicate. Complete the run with the original summary and
  emit an observable enrichment warning.
- Re-review triggers create their own new native review and linked summary; they
  do not rewrite an older review.

## Validation

Tests cover:

- actionable root bodies always list every finding in report order;
- severity and visible title are escaped and rendered compactly;
- inline findings receive only their matching GitHub discussion URL;
- body-only findings render `details below` without a fake link;
- approvals and suggestion-only reviews retain their current concise behavior;
- submission performs POST, scoped comment lookup, authorization, and PUT in
  order;
- malformed, foreign, missing, and duplicate marker/link responses are rejected
  from enrichment;
- enrichment failure after POST cannot trigger a duplicate native review;
- source-artifact recomputation and exact-head publication checks remain intact.

