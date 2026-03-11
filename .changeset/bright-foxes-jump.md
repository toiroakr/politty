---
"politty": patch
---

Support bidirectional camelCase/kebab-case CLI argument resolution. Fields defined in either case now accept CLI input in both formats. Also adds `--noCamelCase` and `--no-kebab-case` boolean negation and blocks the mixed `--no-camelCase` form. Includes collision-safe alias registration and `definedNames` guard that prevents field names starting with "no" from being misinterpreted as boolean negation.
