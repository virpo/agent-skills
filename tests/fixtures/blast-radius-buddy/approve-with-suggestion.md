# Export completion telemetry fixture

Requirement: after an export finishes successfully, emit `export.completed` exactly once with `jobId`, `durationMs`, and `rowCount`. Telemetry failures must not delay or fail the export response.

Repository context: `telemetry.track` is synchronous and non-blocking. The telemetry schema also accepts an optional finite `exportType` dimension (`csv` or `xlsx`), and the in-scope `job.type` already contains that value. The required event remains valid without the optional dimension. The logger call below is the repository's established failure path.

```diff
diff --git a/src/exports/complete-export.ts b/src/exports/complete-export.ts
index 421be8a..9b101c4 100644
--- a/src/exports/complete-export.ts
+++ b/src/exports/complete-export.ts
@@ -42,3 +42,15 @@ export async function completeExport(job, rows, startedAt) {
   const result = await storage.finish(job, rows);
+  const ms = Date.now() - startedAt;
+
+  try {
+    telemetry.track("export.completed", {
+      jobId: job.id,
+      durationMs: ms,
+      rowCount: rows.length
+    });
+  } catch (error) {
+    logger.warn({ error, jobId: job.id }, "export completion telemetry failed");
+  }
+
   return result;
 }
```

Review this pull request. Do not edit files or make live GitHub writes. Describe the review event and GitHub output you would produce.
