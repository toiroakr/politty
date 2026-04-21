---
"politty": patch
---

Add command alias support for subcommands. Commands can now define `aliases` in `defineCommand()` to allow invocation by alternative names. Aliases are displayed in help output, documentation, and shell completions, with validation to prevent conflicts.
