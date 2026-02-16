---
"politty": patch
---

Add dynamic shell completion via `__complete` command

- Add `__complete` command that outputs completion candidates at runtime
- Support dynamic completion mode with `--dynamic` flag in completion command
- Auto-include `__complete` in `withCompletionCommand()` by default
- Add context-aware completion parsing for subcommands, options, and positional arguments
- Support completion directives for file/directory completion
