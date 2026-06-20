---
"politty": patch
---

Unify the options-rendering paths in `src/docs` through a shared `(rows × columns)` intermediate (`toOptionRows` + `emitMarkdownTable`/`emitMarkdownList`). The markdown table and list renderers, their `*FromArray` variants, and `renderArgsTable`'s column-filtered path now share one place where per-option display decisions (negation handling, alias ordering, placeholder resolution) live. Pure refactor — no change to rendered output.
