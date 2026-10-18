---
"@politty/loculus": minor
"@politty/valibot": minor
"@politty/zod": minor
"@politty/zod-mini": minor
"politty": minor
---

Expand object fields of an args schema into one option per property (`--config.port`) and validate their values nested under the field again, instead of accepting a single option that could never validate. The new `flatten` arg option picks the option naming style (`"dot"`, `"kebab"` or `"camel"`). A required object is always created so its properties' defaults apply. An object field now only takes `description` and `flatten` metadata: other `arg()` options such as `alias`, `env` or `effect` on it fail when fields are extracted, so set them on its properties instead. An object field cannot have a default value, a property under a transformed object cannot have an `effect` or `requiredPackages`, an object field cannot be defined by several intersection members, and a required object of a plain union option needs a required property: such schemas fail when fields are extracted. An object both the global args and a command expand is merged property by property.
