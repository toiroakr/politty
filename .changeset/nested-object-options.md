---
"@politty/loculus": minor
"@politty/valibot": minor
"@politty/zod": minor
"@politty/zod-mini": minor
"politty": minor
---

Expand object fields of an args schema into one option per property (`--config.port`) and pass the values to `run` nested again, instead of accepting a single option that could never validate. The new `flatten` arg option picks the option naming style (`"dot"`, `"kebab"` or `"camel"`), and options that collide with another field raise an error. An object field now only takes `description` and `flatten` metadata: other `arg()` options such as `alias`, `env` or `effect` on an object field are a type error and fail when fields are extracted, so set them on its properties instead. An object field cannot have a default value either (`.default(...)` or `.prefault(...)` fails when fields are extracted): give its properties defaults, which apply to a required object even when none of its options is given. Object fields of a union inside an intersection are rejected the same way: put the fields the intersection adds into each union option instead. A property inside an object that has a transform (or pipes into another schema) cannot have an `effect` or `requiredPackages` either, as the transform may change the value they read. The options of a plain union must spell the same property the same way.
