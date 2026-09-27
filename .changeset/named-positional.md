---
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Add `positional: { named: true }` to accept a positional argument as a long option too, such as `--name=-dev` for a value that starts with `-`. Help and generated docs list it once under arguments as `<name>, --name <NAME>`, shell completion also offers `--name`, and when it is given as a long option the next positional token fills the next positional argument.
