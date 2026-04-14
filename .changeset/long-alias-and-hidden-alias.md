---
"politty": patch
---

Extend `alias` to accept `string | string[]`. Multi-character entries
become additional long options (e.g. `alias: "to-be"` accepts both
`--tobe` and `--to-be`), and arrays allow combining short and long
aliases (`alias: ["v", "loud"]`). Kebab-case long aliases also accept
their camelCase variant.

Add `hiddenAlias` (same shape as `alias`) for names the parser should
accept without surfacing them in help, generated docs, or shell
completion — useful for legacy or deprecated option names.
