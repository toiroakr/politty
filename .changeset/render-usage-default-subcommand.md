---
"politty": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"@politty/valibot": patch
---

Fix the docs/help usage line rendering `<command>` (required) instead of `[command]` (optional) for a command group that has `defaultSubCommand` set but no `run`. `renderUsage()` (docs generator) and `renderUsageLine()` (CLI `--help`) both decided between `[command]` and `<command>` based solely on `command.run`, so a group that dispatches to its `defaultSubCommand` when invoked bare was documented as requiring an explicit subcommand even though it isn't. Both now also treat `defaultSubCommand` as "invocable without an explicit subcommand".
