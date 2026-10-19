---
"@politty/loculus": patch
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Read a value-taking short option combined with other short options: `-ac5` and `-ac 5` give `-c` the value `5`, as `-c5` does, instead of reading every character as a boolean flag. `parseArgv` does this for the options in its new `valueFlags` option.
