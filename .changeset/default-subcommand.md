---
"politty": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"@politty/valibot": patch
---

Add a `defaultSubCommand` option to `defineCommand` for command groups that have `subCommands` but no `run`. When set to the name of a registered subcommand (checked at compile time — an unknown key is a type error), invoking the group with no subcommand specified runs that subcommand instead of showing help, correctly inheriting the parent's `globalArgs` values and `precedingArgs` (unlike a hand-rolled `runCommand(defaultCmd, [])` call, which would discard them). This exists for CLI plugin dispatch: `onUnknownSubcommand` skips any command that defines `run` (its first positional is a real argument, not a plugin target) — `defaultSubCommand` lets a group fall back to a runnable subcommand without exempting itself from plugin dispatch. Defining both `run` and `defaultSubCommand` on the same command, or pointing `defaultSubCommand` at a name that isn't a `subCommands` key, is now a validation error (`validateCommand()`, and a new throwing `validateDefaultSubCommand()`).
