---
"politty": minor
---

Add Standard Schema support so schema libraries other than Zod (Valibot, ArkType, ...) can be used for command argument definitions.

Breaking changes (hence a minor bump under the pre-1.0 policy):

- `ArgsSchema` is now `StandardSchemaV1<unknown, Record<string, any>>` instead of `z.ZodType<...>`, so the type no longer exposes Zod-specific methods. Zod schemas still satisfy it and work unchanged.
- `skillFrontmatterSchema` (exported from `politty/skill`) is no longer a Zod schema; it is now politty's internal schema. `.safeParse(...)` and inferred types still work, but Zod-only methods (`.parse`, `.extend`, ...) do not.
- The docs `ArgsShape` type (`politty/docs`) is now `Record<string, StandardSchemaV1>` instead of `Record<string, z.ZodType>`.
- The Zod-only helper `getUnknownKeysMode` is no longer exported from `politty`; import it from `politty/zod`. Zod CLIs should import from `politty/zod` (bare `politty` still accepts Zod via the generic JSON-Schema fallback, but that path is asynchronous and needs `@standard-community/standard-json`).
- `zod` is now an optional peer dependency.

- Non-Zod schemas are introspected by converting them to JSON Schema via the optional `@standard-community/standard-json` package (plus the vendor converter, e.g. `@valibot/to-json-schema` for Valibot or `arktype` for ArkType). Zod continues to use its native, fully-featured introspection path.
- Schema support is now adapter-based, split across dedicated entrypoints you import per schema library:
  - `politty/zod` — native Zod introspection (`_def` walk) + `safeParse`; synchronous, no extra dependency. Also re-exports the Zod-only helpers `getUnknownKeysMode` / `extractEnumValues`.
  - `politty/valibot` — native Valibot introspection (reads `.entries` / `.options` / `.wrapped` / `.default` / `.key` directly); synchronous, needs only `valibot` (no `@standard-community/standard-json` / `@valibot/to-json-schema`).
  - `politty/standard-schema` — the generic JSON-Schema adapter for any other Standard Schema library (ArkType, ...). This adapter is also bundled into bare `politty` as the fallback, so `import { ... } from "politty"` keeps working for every vendor (via JSON Schema conversion, which needs `@standard-community/standard-json`). For zero-dependency, synchronous Zod/Valibot, import their dedicated entrypoint.

  Each vendor entrypoint re-exports the entire core API and registers its adapter on import, so a Valibot/ArkType CLI never bundles the Zod introspector and vice versa.

- `arg()` metadata (alias, positional, description, completion, ...) now works for any Standard Schema library: metadata is stored in a vendor-agnostic `WeakMap` registry and recovered from the original schema's child references (Valibot `.entries`, ArkType `.get()`).
- Composite schemas reach parity with the Zod path for non-Zod libraries: JSON Schema combinators are mapped to politty's shapes — `allOf` → intersection, `oneOf`/`anyOf` → discriminated union when a discriminator (a distinct string literal shared by every branch) is detected, otherwise xor (`oneOf`) or union (`anyOf`). This enables variant-aware help, docs, and prompting for Valibot `variant`/`union`/`intersect` and ArkType `.or`/`.and`. Per-branch `arg()` metadata is recovered when the vendor exposes ordered branch sub-schemas (Valibot `.options`).
- Validation of non-Zod schemas goes through the `~standard.validate` interface (awaited for async validators). Returned `ValidationError`s are enriched with `code` / `expected` / `received` on a best-effort, vendor-agnostic basis (recovered from the library's issue object: ArkType `code`/`expected`/`actual`, Valibot `type`/`expected`/`received`), matching the Zod path's surface. Issue paths are normalized to a plain `string[]`.
- politty no longer imports Zod at runtime anywhere. All built-in commands (`completion`, the `__complete` dispatcher, the `cli` worker generator, and the `skill` commands) plus SKILL.md frontmatter validation were rewritten to use a tiny zero-dependency internal schema, and the `politty/docs` helpers now extract arg shapes vendor-agnostically (per-field, dispatched by Standard Schema vendor) instead of wrapping them in `z.object`. As a result every entrypoint — `politty`, `politty/completion`, `politty/skill`, `politty/cli`, and `politty/docs` — loads no Zod code; running a Valibot/ArkType CLI never pulls Zod in.
- String→value coercion (e.g. number parsing), which JSON Schema cannot represent, is handled by lenient conversion options per vendor so introspection still works.

`ArgsSchema` is now `StandardSchemaV1<unknown, Record<string, any>>` and `arg()`/`defineCommand` accept any Standard Schema library; existing Zod usage is unaffected.
