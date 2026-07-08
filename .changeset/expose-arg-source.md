---
"politty": patch
---

Add `args.$source(name)` to expose whether a resolved arg value came from an explicit CLI token (`"cli"`), a `field.env` fallback (`"env"`), or neither (`"default"`). This lets a command's `run()` handler distinguish an explicitly-typed value from an environment-variable fallback without re-deriving flag spellings from the schema, and works correctly for `positional` fields even when the typed value happens to equal the env var. `$source` correctly resolves both camelCase and kebab-case field name lookups, and correctly reports `"default"` for a local field that collides with a same-named global field but is resolved via the local schema's own default.

`$source`'s parameter is typed as a plain `string` rather than a schema-derived key, since a stricter type broke type-checking for the documented discriminated-union `args` pattern.

Field names starting with `"$"` are now rejected at command-definition time (`ReservedFieldNameError`), since that prefix is reserved for framework-injected helpers like `$source` and is unusable as a real CLI flag anyway (an unquoted `$name` gets shell-expanded before the program sees it).
