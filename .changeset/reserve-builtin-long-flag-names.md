---
"politty": minor
"@politty/zod": minor
"@politty/zod-mini": minor
"@politty/valibot": minor
---

**Breaking change:** A field's `cliName` (its kebab-case name) or any long alias (`alias`/`hiddenAlias` entries longer than one character) can no longer be `help`, `help-all`, or `version` without explicit opt-in. These long flags are always intercepted by `parseArgs`/`scanForSubcommand` before schema parsing, regardless of which field produced the name, so an unguarded collision silently made that field unreachable. `defineCommand` now throws a `ReservedAliasError` at definition time for this collision, matching the existing reservation of the short aliases `-h`/`-H`. Set `overrideBuiltinAlias: true` on the field to opt in, exactly as already required for `-h`/`-H`.
