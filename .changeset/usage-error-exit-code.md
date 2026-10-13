---
"@politty/valibot": minor
"@politty/zod": minor
"@politty/zod-mini": minor
"politty": minor
---

Exit with code 2 instead of 1 when the command line is invalid: an unknown flag or subcommand, an unexpected positional argument, or arguments that fail validation. `runMain` exits with it and `runCommand` reports it as `exitCode`, so scripts and agents can tell a mistyped invocation from a command that failed while running, which still exits with 1. Code that checks for exit code 1 after an invalid command line needs to accept 2.
