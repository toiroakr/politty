---
"@politty/zod-mini": minor
---

Add `@politty/zod-mini`: politty with `zod/mini` schemas. The new package exposes the same API surface as `@politty/zod` (`defineCommand`, `arg`, `runMain`, docs/completion/skill/prompt subpaths, and the `politty` bin), backed by a structural zod/mini validator adapter — the same `.def`-based introspection the classic zod adapter uses, with `.isOptional()`/`.description`/`.meta()` (unavailable on `zod/mini`) replaced by `.safeParse(undefined)` and reads from zod's `globalRegistry`. Field metadata comes from `arg()` as well as `.register(z.globalRegistry, {...})`. There is no `@politty/zod-mini/augment` module, matching `@politty/valibot`'s precedent — use `arg()` or the registry instead of the classic-only `GlobalMeta` augmentation.
