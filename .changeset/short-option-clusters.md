---
"@politty/loculus": patch
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Read the value of a value-taking short option attached to it (`-c5`) or combined with other short options (`-ac5`, `-ac 5`), instead of reading every character as a boolean flag. `parseArgv` does this for the options in its new `valueFlags` option.

Read combined short options that are all global, such as `-vq` or `-n5`, as global options before and after a subcommand. Before, they stopped subcommand detection before a subcommand and were dropped after it. Combined short options that mix global and command options are still read by the command. Dynamic completion reads combined short options the same way.
