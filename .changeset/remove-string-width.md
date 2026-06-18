---
"politty": patch
---

Removed the `string-width` runtime dependency

- Replaced it with a lightweight built-in implementation (using Node's `stripVTControlCharacters` for ANSI stripping) used by the Markdown renderer
- `politty` now has zero runtime dependencies
