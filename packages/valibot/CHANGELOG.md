# @politty/valibot

## 0.1.0

### Minor Changes

- ac7e85a: Add `@politty/valibot`: politty with valibot schemas. The new package exposes the same API surface as `@politty/zod` (`defineCommand`, `arg`, `runMain`, docs/completion/skill/prompt subpaths, and the `politty` bin) backed by a valibot validator adapter, and its published build never loads zod. Field metadata is read from `arg()` as well as valibot's `v.description()` / `v.metadata()` pipe actions.

  Supporting this, `@politty/core`'s public types now constrain schemas through the Standard Schema interface, and each adapter package re-pins the schema-taking API (`ArgsSchema`, `defineCommand`, `createDefineCommand`, `arg`) to its own library's schema type — `@politty/zod` keeps politty's historical zod-typed surface, so existing `politty` / `@politty/zod` users are unaffected, and a schema from the wrong library is now a type error instead of a runtime failure.

  Also fixes two things about wrapped args schemas, in both adapters:

  - Field extraction now unwraps the wrapper. A defaulted wrapper keeps an object output type, so `z.object({...}).default({...})` (and the valibot equivalent) type-checks as an args schema, but extraction fell through to its fallback and returned zero fields — positionals were rejected as "Unexpected positional argument" and help, docs, and completion came out empty for the whole command.
  - Unknown-keys detection unwraps too: `z.strictObject({...}).optional()` (or a top-level `.transform()` pipe) reported `strip`, so unknown CLI flags were warned-and-ignored while validation enforced the inner object's strict behavior.

  In `@politty/valibot`, type detection for the `unknown`-based coercion pipe now finds the pipe wherever composition puts it. Because `v.pipe` spreads its base schema, piping a wrapper leaves the pipe on the wrapper node while the `unknown` it wraps has none, so `v.pipe(v.optional(v.unknown()), v.transform(Number), v.number())` was reported as an `unknown` field in help, prompts, and completion instead of a number.

  Published packages no longer ship `.js` files pointing at source maps that were excluded from the tarball — map emit is off now, so `dist/**/*.js` has no dangling `sourceMappingURL`.

  Every published tarball now carries the MIT `LICENSE` alongside the README. `prepublishOnly` copied only `README.md` from the repo root, so the license text the `"license": "MIT"` field refers to was absent from the package itself.

  Docs generation now identifies a schema by its Standard Schema `~standard` marker instead of probing for zod's `safeParse` method. The old probe misread the shorthand `rootDoc.globalOptions` form when one of its options happened to be named `args`, because valibot schemas expose no `safeParse` — generating docs for such a config crashed.

### Patch Changes

- 20e0eca: Fix `generate-shim` baking a fixed import specifier into the shims it writes.

  The generated bin shim enables the Node.js compile cache by importing `enableCompileCache`, and that import specifier was hard-coded with no way to change it. A CLI depending on this package could not resolve the hard-coded one from its own package, so the shim's `catch` swallowed the failure and the CLI ran with the compile cache permanently disabled — silently, since the shim is designed to degrade rather than fail.

  Each package now generates shims that import from its own `compile-cache` subpath. Reaching the generator at all — through the package's `politty` bin or through an import of it — means that package is installed in the host, so the specifier resolves from the shim that lands there.

  Regenerating an existing shim picks the corrected specifier up, including shims generated before the workspace split — the overwrite marker is unchanged.

  New `--compile-cache-specifier` flag (`compileCacheSpecifier` option) overrides it for setups where the cache helper is reached some other way, such as a re-export from your own package. `generate-shim` now also reports the specifier it used, and `generateCompileCacheShim` returns it as `compileCacheSpecifier` on each result.
