---
"@politty/zod": patch
"@politty/valibot": patch
---

Fix `generate-shim` baking a fixed import specifier into the shims it writes.

The generated bin shim enables the Node.js compile cache by importing `enableCompileCache`, and that import specifier was hard-coded with no way to change it. A CLI depending on this package could not resolve the hard-coded one from its own package, so the shim's `catch` swallowed the failure and the CLI ran with the compile cache permanently disabled — silently, since the shim is designed to degrade rather than fail.

Each package now generates shims that import from its own `compile-cache` subpath. Reaching the generator at all — through the package's `politty` bin or through an import of it — means that package is installed in the host, so the specifier resolves from the shim that lands there.

Regenerating an existing shim picks the corrected specifier up, including shims generated before the workspace split — the overwrite marker is unchanged.

New `--compile-cache-specifier` flag (`compileCacheSpecifier` option) overrides it for setups where the cache helper is reached some other way, such as a re-export from your own package. `generate-shim` now also reports the specifier it used, and `generateCompileCacheShim` returns it as `compileCacheSpecifier` on each result.
