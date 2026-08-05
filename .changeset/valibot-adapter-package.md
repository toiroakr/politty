---
"@politty/valibot": minor
"@politty/zod": patch
"politty": patch
---

Add `@politty/valibot`: politty with valibot schemas. The new package exposes the same API surface as `@politty/zod` (`defineCommand`, `arg`, `runMain`, docs/completion/skill/prompt subpaths, and the `politty` bin) backed by a valibot validator adapter, and its published build never loads zod. Field metadata is read from `arg()` as well as valibot's `v.description()` / `v.metadata()` pipe actions. Supporting this, `@politty/core`'s public types now constrain schemas through the Standard Schema interface; `@politty/zod` re-pins its exported `ArgsSchema` to the historical zod-typed shape, so existing `politty` / `@politty/zod` users are unaffected.
