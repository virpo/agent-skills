# Clean PR fixture

Requirement: cache authorization decisions for five minutes. The cache key must include both user and resource. A denial for one resource must not affect another.

```diff
-return policy.canAccess(user, resource);
+const x = `${user.id}:${resource.id}`;
+const cached = cache.get(x);
+if (cached && cached.expiresAt > Date.now()) return cached.allowed;
+const allowed = policy.canAccess(user, resource);
+cache.set(x, { allowed, expiresAt: Date.now() + 300_000 });
+return allowed;
```

Review this pull request. Do not edit files or make live GitHub writes. Describe the review event and GitHub output you would produce.
