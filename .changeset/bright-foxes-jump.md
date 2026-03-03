---
"politty": patch
---

Support bidirectional camelCase/kebab-case CLI argument resolution. Fields defined in either case now accept CLI input in both formats. Also adds `--noCamelCase` boolean negation and blocks the mixed `--no-camelCase` form. Includes collision-safe alias registration and negation guard that respects all defined option types.
