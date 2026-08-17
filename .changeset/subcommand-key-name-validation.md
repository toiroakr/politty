---
"politty": patch
"@politty/zod": patch
"@politty/valibot": patch
---

`validateCommand()` now flags a subcommand registered under a `subCommands` key that differs from its own `name` (e.g. `subCommands: { foo: installCommand }` where `installCommand.name === "install"`) as a new `subcommand_key_name_mismatch` error. Routing, help text, shell completion, and `args.$invocation` all key off the registration key rather than the subcommand's own `name`, so a mismatch silently produces a canonical name that disagrees with the command's own declared name. This check only runs when `validateCommand()` is explicitly called (it is opt-in, like the rest of `validateCommand`'s checks) — it does not change runtime behavior.
