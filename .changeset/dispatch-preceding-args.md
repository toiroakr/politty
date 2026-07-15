---
"politty": patch
---

Add `precedingArgs` to the `onUnknownSubcommand` context: the option tokens consumed before the unknown subcommand name across every traversed level (e.g. global flags typed before a plugin command), excluding the traversed subcommand names themselves. Dispatchers can forward `[...precedingArgs, ...args]` so a global flag placed before the plugin command still reaches the plugin.
