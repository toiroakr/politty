---
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Fix `createLogCollector` (used by `executeExamples`/`assertDocMatch`) to also capture output written directly via `process.stdout.write` / `process.stderr.write`, not just `console.*` calls. Previously, a command that printed its primary output with `process.stdout.write` instead of `console.log` was invisible to `examples` verification — that output passed straight through to the real stdout and never showed up in the captured logs.
