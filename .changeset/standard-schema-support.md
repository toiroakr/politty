---
"politty": patch
---

Add Standard Schema support so schema libraries other than Zod (Valibot, ArkType, ...) can be used for command argument definitions.

- Non-Zod schemas are introspected by converting them to JSON Schema via the optional `@standard-community/standard-json` package (plus the vendor converter, e.g. `@valibot/to-json-schema` for Valibot or `arktype` for ArkType). Zod continues to use its native, fully-featured introspection path.
- `arg()` metadata (alias, positional, description, completion, ...) now works for any Standard Schema library: metadata is stored in a vendor-agnostic `WeakMap` registry and recovered from the original schema's child references (Valibot `.entries`, ArkType `.get()`).
- Validation of non-Zod schemas goes through the `~standard.validate` interface (awaited for async validators).
- The politty core no longer imports Zod at runtime. All built-in commands (`completion`, the `__complete` dispatcher, the `cli` worker generator, and the `skill` commands) plus SKILL.md frontmatter validation were rewritten to use a tiny zero-dependency internal schema. As a result the `politty`, `politty/completion`, `politty/skill`, and `politty/cli` entrypoints load no Zod code — running a Valibot/ArkType CLI never pulls Zod in. (The `politty/docs` helper, which documents Zod arg shapes, still uses Zod by design.)
- String→value coercion (e.g. number parsing), which JSON Schema cannot represent, is handled by lenient conversion options per vendor so introspection still works.

`ArgsSchema` is now `StandardSchemaV1<unknown, Record<string, any>>` and `arg()`/`defineCommand` accept any Standard Schema library; existing Zod usage is unaffected.
