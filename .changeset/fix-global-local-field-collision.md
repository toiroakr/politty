---
"politty": patch
---

Fix global/local arg collisions on a shared field name. Two changes:

- Command definitions where a global field and a same-named local field have different definitions (different type bucket, or different enum values) now throw `FieldTypeConflictError` at validation time — previously this silently passed even though the two fields didn't actually agree on what values are valid.
- When the definitions are identical, a flag shared between `globalArgs` and a command's own schema now resolves correctly regardless of where it's typed — including when the command's own field is required and has no default. Previously, typing the flag _before_ the subcommand parsed it correctly as the global value, but the command's own same-named field — having received nothing of its own — would either fail local validation (if required) or unconditionally get overwritten by its own default during the final args merge, discarding what the user actually typed. Typing the same flag _after_ the subcommand already worked correctly and is unaffected.
