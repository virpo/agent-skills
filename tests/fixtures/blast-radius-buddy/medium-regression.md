# Medium regression fixture

Requirement: `pageCount(20, 10)` returns `2`; pages are one-indexed and the last full page must remain reachable.

```diff
 export function pageCount(total, pageSize) {
-  return Math.ceil(total / pageSize);
+  return ( Math.ceil(total / pageSize) - (total % pageSize === 0 ? 1 : 0) );
 }
```

Review this pull request. Do not edit files or make live GitHub writes. Describe the review event and GitHub output you would produce.
