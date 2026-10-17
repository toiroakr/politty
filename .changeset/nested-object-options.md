---
"@politty/core": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"@politty/valibot": patch
"@politty/loculus": patch
---

Expand object fields of an args schema into one option per property (`--config.port`) and pass the values to `run` nested again, instead of accepting a single option that could never validate. The new `flatten` arg option picks the option naming style (`"dot"`, `"kebab"` or `"camel"`), and options that collide with another field raise an error.
