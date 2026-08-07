---
"@politty/valibot": minor
"@politty/zod": patch
"politty": patch
---

Add `@politty/valibot`: politty with valibot schemas. The new package exposes the same API surface as `@politty/zod` (`defineCommand`, `arg`, `runMain`, docs/completion/skill/prompt subpaths, and the `politty` bin) backed by a valibot validator adapter, and its published build never loads zod. Field metadata is read from `arg()` as well as valibot's `v.description()` / `v.metadata()` pipe actions.

Supporting this, `@politty/core`'s public types now constrain schemas through the Standard Schema interface, and each adapter package re-pins the schema-taking API (`ArgsSchema`, `defineCommand`, `createDefineCommand`, `arg`) to its own library's schema type — `@politty/zod` keeps politty's historical zod-typed surface, so existing `politty` / `@politty/zod` users are unaffected, and a schema from the wrong library is now a type error instead of a runtime failure.

Also fixes two things about wrapped args schemas, in both adapters:

- Field extraction now unwraps the wrapper. A defaulted wrapper keeps an object output type, so `z.object({...}).default({...})` (and the valibot equivalent) type-checks as an args schema, but extraction fell through to its fallback and returned zero fields — positionals were rejected as "Unexpected positional argument" and help, docs, and completion came out empty for the whole command.
- Unknown-keys detection unwraps too: `z.strictObject({...}).optional()` (or a top-level `.transform()` pipe) reported `strip`, so unknown CLI flags were warned-and-ignored while validation enforced the inner object's strict behavior.

Published packages no longer ship `.js` files pointing at source maps that were excluded from the tarball — map emit is off now, so `dist/**/*.js` has no dangling `sourceMappingURL`.

Every published tarball now carries the MIT `LICENSE` alongside the README. `prepublishOnly` copied only `README.md` from the repo root, so the license text the `"license": "MIT"` field refers to was absent from the package itself.

Docs generation now identifies a schema by its Standard Schema `~standard` marker instead of probing for zod's `safeParse` method. The old probe misread the shorthand `rootDoc.globalOptions` form when one of its options happened to be named `args`, because valibot schemas expose no `safeParse` — generating docs for such a config crashed.
