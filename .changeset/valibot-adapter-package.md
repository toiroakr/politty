---
"@politty/valibot": minor
"@politty/zod": patch
"politty": patch
---

Add `@politty/valibot`: politty with valibot schemas. The new package exposes the same API surface as `@politty/zod` (`defineCommand`, `arg`, `runMain`, docs/completion/skill/prompt subpaths, and the `politty` bin) backed by a valibot validator adapter, and its published build never loads zod. Field metadata is read from `arg()` as well as valibot's `v.description()` / `v.metadata()` pipe actions.

Supporting this, `@politty/core`'s public types now constrain schemas through the Standard Schema interface, and each adapter package re-pins the schema-taking API (`ArgsSchema`, `defineCommand`, `createDefineCommand`, `arg`) to its own library's schema type — `@politty/zod` keeps politty's historical zod-typed surface, so existing `politty` / `@politty/zod` users are unaffected, and a schema from the wrong library is now a type error instead of a runtime failure.

Also fixes unknown-keys detection for wrapped args schemas in both adapters: `z.strictObject({...}).optional()` (or a top-level `.transform()` pipe) reported `strip`, so unknown CLI flags were warned-and-ignored while validation enforced the inner object's strict behavior.
