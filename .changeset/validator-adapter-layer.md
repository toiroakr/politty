---
"politty": patch
---

Decouple the core from zod behind a validator-adapter layer (first step of #650).

- All zod-specific schema introspection and validation now live in a dedicated zod adapter implementing a neutral `ValidatorAdapter` interface; the parser, runner, help, completion, docs, and prompt layers consume only the validator-neutral `ExtractedFields` metadata.
- politty's built-in commands (`completion`, `skills`, `__complete`, the `politty` bin) describe their args with internal validator-free descriptors instead of zod schemas.
- As a result, importing `politty` (and `politty/completion`, `politty/docs`, `politty/prompt/*`, `politty/cli`) no longer loads zod at runtime — zod is only loaded when one of your own schemas flows through parsing or validation. `politty/skill` still loads zod solely for the deprecated `skillFrontmatterSchema` export.

No behavior or public API changes; all existing schemas, types, and error output work exactly as before.
