---
"politty": patch
"@politty/zod": patch
"@politty/valibot": patch
---

Add `args.$invocation` to expose the CLI name (or alias) a command's `run()` was actually invoked with: `{ name }` when invoked by its canonical name (or run directly, with no subcommand routing involved), or `{ name, aliasFor }` when `name` is one of the command's `aliases` and `aliasFor` is the canonical name it resolves to. This lets `run()` tell which alias was used without hard-coding alias strings to detect the "was this an alias at all" case (`if (args.$invocation?.aliasFor)`).
