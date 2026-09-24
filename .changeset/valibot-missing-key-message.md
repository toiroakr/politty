---
"@politty/valibot": patch
---

Report a missing required argument as `Missing required argument <file>` or `Missing required option --out-dir` instead of valibot's default `Invalid key: Expected "<key>" but received undefined`. A message customized through the object schema or valibot's global message config is kept as is.
