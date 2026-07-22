# Clean PR fixture

Requirement: cache authorization decisions for five minutes. The cache key must include both user and resource. A denial for one resource must not affect another.

Repository context: `cache` is a bounded TTL cache with a maximum of 10,000 entries. `get` deletes expired entries, and `set(key, value, ttlMs)` applies the TTL and evicts the least-recently-used entry at capacity. User and resource IDs are arbitrary strings.

```diff
-return policy.canAccess(user, resource);
+const k = JSON.stringify([user.id, resource.id]);
+const cached = cache.get(k);
+if (cached !== undefined) return cached;
+const allowed = policy.canAccess(user, resource);
+cache.set(k, allowed, 300_000);
+return allowed;
```

Review this pull request. Do not edit files or make live GitHub writes. Describe the review event and GitHub output you would produce.
