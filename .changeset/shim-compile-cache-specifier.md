---
"@politty/zod": patch
"@politty/valibot": patch
"politty": patch
---

Fix `generate-shim` baking a fixed `politty/compile-cache` import into the shims it writes.

The generated bin shim enables the Node.js compile cache by importing `enableCompileCache`, and that import specifier was hard-coded to `politty/compile-cache` with no way to change it. A CLI that depends on `@politty/zod` or `@politty/valibot` instead cannot resolve `politty` from its own package, so the shim's `catch` swallowed the failure and the CLI ran with the compile cache permanently disabled — silently, since the shim is designed to degrade rather than fail.

The specifier is now derived from the same `package.json` the generator already reads for the output paths and program names: the first of `@politty/zod`, `@politty/valibot`, `politty` declared in `dependencies`, `peerDependencies` or `devDependencies`. The shim executes inside the host package, so only a politty package that package declares is guaranteed to resolve from it. Declaring none warns and keeps the previous `politty/compile-cache` fallback, so hosts that resolve politty through hoisting are unaffected.

Regenerating an existing shim picks the corrected specifier up, including shims generated before the workspace split — the overwrite marker is unchanged.

New `--compile-cache-specifier` flag (`compileCacheSpecifier` option) overrides the derived value for setups where politty is reached some other way, such as a re-export from your own package. `generate-shim` now also reports the specifier it used, and `generateCompileCacheShim` returns it as `compileCacheSpecifier` on each result.
