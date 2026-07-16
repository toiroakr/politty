---
"politty": patch
---

Add Node.js on-disk compile cache (V8 code cache) support for faster warm starts.

- `runMain` now enables the compile cache automatically (Node.js >= 22.8.0; silent no-op otherwise), so dynamically imported modules such as `lazy()` subcommands skip recompilation. The cache directory follows the same XDG convention as the shell-completion workers (`${XDG_CACHE_HOME:-$HOME/.cache}/<command name>/node-compile-cache`) and `NODE_COMPILE_CACHE` always takes precedence. Opt out or override via the new `MainOptions.compileCache` option (`false` | custom directory).
- New dependency-free `politty/compile-cache` subpath exporting `enableCompileCache`, for the bin-shim pattern that caches the whole CLI graph (ESM static imports are compiled before any code runs, so full coverage requires enabling the cache in a minimal shim that loads the real entry with a dynamic import). See "Faster Startup (Compile Cache)" in docs/recipes.md.
- New `politty generate-shim` CLI command (and `generateCompileCacheShim` export) that generates one bin shim per `bin` entry as part of a `postbuild`/`prepack` script. Output paths default to the package's `bin` paths and program names to the `bin` names; `--entry` is repeatable for multi-bin packages (paired in declaration order, or with `--out` paths of the same count) and can be omitted when a conventional built module (`./cli.js`, `./index.js`, ...) sits next to the shim. Refuses to overwrite files it did not generate.
