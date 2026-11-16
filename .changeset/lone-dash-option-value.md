---
"@politty/loculus": patch
"@politty/zod": patch
"@politty/valibot": patch
"@politty/zod-mini": patch
"politty": patch
---

Fix a lone `-` after a value-taking option (`--out -`, `-o -`) not being read as its value. The option became `true` and failed type validation, and a global option such as `--out - sub` never reached the subcommand. `--out=-` and `--out -5` already worked; `--` is still not read as a value.
