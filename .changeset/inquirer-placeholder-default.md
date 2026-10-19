---
"@politty/loculus": patch
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Stop the `prompt/inquirer` resolver from submitting an argument's help `placeholder` (e.g. `FILE`) as its value when the user presses Enter on an empty text prompt. The placeholder is no longer passed to inquirer as `default`, so empty input gives `""` as with the `prompt/clack` resolver. inquirer has no hint-only option, so the inquirer prompt no longer shows the placeholder.
