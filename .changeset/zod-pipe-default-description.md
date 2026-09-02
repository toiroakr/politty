---
"@politty/zod": patch
---

Fix the zod adapter to recurse through `pipe` wrapper nodes (`.transform()`/`.refine()`), not just `optional`/`nullable`/`default`, in three places:

- `extractDefaultValue` and `extractDescription`: a default or description declared before a transform pipe (e.g. `z.string().default("hello").transform((s) => s.toUpperCase())`) was silently dropped from `ResolvedFieldMeta`, even though the default itself was applied correctly at parse time — producing an internally inconsistent `required: false` with no visible default in help text and generated docs.
- `getArgMeta`: `arg()` metadata (alias, description, etc.) registered on a schema that is then wrapped in `.default()`/`.optional()`/`.nullable()` and piped through a transform (e.g. `arg(z.string().default("info"), { alias: "L" }).transform(...)`) was silently dropped, since only the outer pipe and the fully-unwrapped inner schema were checked, skipping the intermediate wrapper the metadata was registered on.
