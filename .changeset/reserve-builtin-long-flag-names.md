---
"politty": minor
"@politty/zod": minor
"@politty/zod-mini": minor
"@politty/valibot": minor
---

**Breaking change:** A field's `cliName` (its kebab-case name) or any long alias (`alias`/`hiddenAlias` entries longer than one character) can no longer be `help`, `help-all`, or `version`. These long flags are always intercepted by `parseArgs`/`scanForSubcommand` before schema parsing, regardless of which field produced the name, so an unguarded collision silently made that field unreachable. `parseArgs()` now throws a `ReservedAliasError` for this collision; `runCommand()` catches it into `{ success: false, error }` instead of throwing, `runMain()` reports it and exits with a non-zero code instead of returning at all, and the explicit `validateCommand()` collects it into `{ valid: false, errors }` without throwing. Unlike the existing reservation of the short aliases `-h`/`-H`, this has no `overrideBuiltinAlias: true` opt-in: the long flag is always resolved as the built-in before any field is consulted, so an override would only suppress the error without making the field reachable. Rename the colliding field or alias instead.
