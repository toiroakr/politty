---
"politty": minor
---

Add Standard Schema support so schema libraries other than Zod (Valibot, ArkType, ...) can be used for command argument definitions.

Breaking changes (hence a minor bump under the pre-1.0 policy):

- `ArgsSchema` is now `StandardSchemaV1<unknown, Record<string, any>>` instead of `z.ZodType<...>`, so the type no longer exposes Zod-specific methods. Zod schemas still satisfy it and work unchanged.
- `skillFrontmatterSchema` (exported from `politty/skill`) is no longer a Zod schema; it is now politty's internal schema. `.safeParse(...)` and inferred types still work, but Zod-only methods (`.parse`, `.extend`, ...) do not.
- The docs `ArgsShape` type (`politty/docs`) is now `Record<string, StandardSchemaV1>` instead of `Record<string, z.ZodType>`.
- `zod` is now an optional peer dependency.

- Non-Zod schemas are introspected by converting them to JSON Schema via the optional `@standard-community/standard-json` package (plus the vendor converter, e.g. `@valibot/to-json-schema` for Valibot or `arktype` for ArkType). Zod continues to use its native, fully-featured introspection path.
- `arg()` metadata (alias, positional, description, completion, ...) now works for any Standard Schema library: metadata is stored in a vendor-agnostic `WeakMap` registry and recovered from the original schema's child references (Valibot `.entries`, ArkType `.get()`).
- Composite schemas reach parity with the Zod path for non-Zod libraries: JSON Schema combinators are mapped to politty's shapes — `allOf` → intersection, `oneOf`/`anyOf` → discriminated union when a discriminator (a distinct string literal shared by every branch) is detected, otherwise xor (`oneOf`) or union (`anyOf`). This enables variant-aware help, docs, and prompting for Valibot `variant`/`union`/`intersect` and ArkType `.or`/`.and`. Per-branch `arg()` metadata is recovered when the vendor exposes ordered branch sub-schemas (Valibot `.options`).
- Validation of non-Zod schemas goes through the `~standard.validate` interface (awaited for async validators).
- politty no longer imports Zod at runtime anywhere. All built-in commands (`completion`, the `__complete` dispatcher, the `cli` worker generator, and the `skill` commands) plus SKILL.md frontmatter validation were rewritten to use a tiny zero-dependency internal schema, and the `politty/docs` helpers now extract arg shapes vendor-agnostically (per-field, dispatched by Standard Schema vendor) instead of wrapping them in `z.object`. As a result every entrypoint — `politty`, `politty/completion`, `politty/skill`, `politty/cli`, and `politty/docs` — loads no Zod code; running a Valibot/ArkType CLI never pulls Zod in.
- String→value coercion (e.g. number parsing), which JSON Schema cannot represent, is handled by lenient conversion options per vendor so introspection still works.

`ArgsSchema` is now `StandardSchemaV1<unknown, Record<string, any>>` and `arg()`/`defineCommand` accept any Standard Schema library; existing Zod usage is unaffected.
