---
"politty": minor
---

Add args and index marker support for documentation files

- `FileConfig` now supports `args` and `index` options
- Args markers: `<!-- politty:args:<identifier>:start/end -->`
- Index markers: `<!-- politty:index:<identifier>:start/end -->`

This allows validating and updating standalone sections in documentation files without requiring command sections. Useful for generating reference documentation that combines args tables and command indexes with manually maintained content.
