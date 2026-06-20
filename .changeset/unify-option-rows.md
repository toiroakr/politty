---
"politty": patch
---

Unify the options-rendering paths in `src/docs` through a shared `(rows × columns)` intermediate (`toOptionRows` + `emitMarkdownTable`/`emitMarkdownList`). The markdown table and list renderers, their `*FromArray` variants, and `renderArgsTable`'s column-filtered path now share one place where per-option display decisions (negation handling, alias ordering, placeholder resolution) live.

Rendered output is unchanged except for one cosmetic detail: `renderArgsTable(args, { columns })` now emits the canonical fixed-width table separator (`|--------|...`) instead of header-length, space-padded dashes (`| ------ | ... |`). The two forms render identically as Markdown.
