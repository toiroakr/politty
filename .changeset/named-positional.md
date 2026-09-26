---
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Add `positional: { named: true }` to accept a positional argument as a long option too, such as `--name=-dev` for a value that starts with `-`. The argument is listed under both arguments and options in help, generated docs, and shell completion, and when it is given as a long option the next positional token fills the next positional argument.
