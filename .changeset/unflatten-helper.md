---
"@politty/zod": patch
"@politty/zod-mini": patch
"@politty/valibot": patch
"@politty/loculus": minor
"politty": patch
---

Add `unflatten` to receive related options as a nested object. Declare the options with dotted keys (`"config.serverPort"`, or kebab-case and camelCase keys with listed prefixes) and wrap the object schema: each key stays an ordinary option with its own `arg()` metadata, and only the validated value handed to `run` is nested. `effect` and `requiredPackages` now read a field's value at its nested path, and the groups of `globalArgs` and a command's args are merged key by key. `@politty/loculus` re-exports `unflatten` so that politty can find the nested path, and now requires `loculus` 0.4.0 or later.
