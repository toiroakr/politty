---
"@politty/valibot": minor
"@politty/zod": minor
"@politty/zod-mini": minor
"politty": minor
---

Stop accepting a positional argument as a long option. Previously `--name=dev` or `--name dev` silently filled a positional `name` (also through its kebab-case form, such as `--output-file` for `outputFile`); it is now reported as an unknown flag, which fails under a strict schema and warns under the default strip mode, and the positional stays unset.
