---
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Treat a `true` literal argument (`z.literal(true)`, `v.literal(true)`) as a boolean flag. It previously had an unknown type, so a union option that defines such a flag no longer matched `--flag` given without a value and failed with `Arguments match none of the accepted forms.`; help and generated docs also showed it as `--flag <FLAG>`.
