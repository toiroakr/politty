---
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Treat an argument that accepts only boolean values as a boolean flag: `z.literal(true)`, `z.literal(false)`, `z.literal([true, false])`, a union of boolean literals, and their valibot counterparts. They previously had an unknown type, so a union option that defines such a flag no longer matched `--flag` given without a value and failed with `Arguments match none of the accepted forms.`, `--flag=false` was not read as `false`, and help and generated docs showed the flag as `--flag <FLAG>`.
