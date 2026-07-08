---
"politty": patch
---

Add `args.$source(name)` to expose whether a resolved arg value came from an explicit CLI token (`"cli"`), a `field.env` fallback (`"env"`), or neither (`"default"`). This lets a command's `run()` handler distinguish an explicitly-typed value from an environment-variable fallback without re-deriving flag spellings from the schema, and works correctly for `positional` fields even when the typed value happens to equal the env var.
