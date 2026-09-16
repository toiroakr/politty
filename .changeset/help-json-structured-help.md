---
"politty": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"@politty/valibot": patch
---

Added a `--help-json` flag and a `generateHelpData(command, options?)` function that produce a structured, JSON-serializable representation of a command's help (name, description, positionals, options, discriminated-union/union variants, global options, examples, notes, and the full recursive subcommand tree — except legacy subcommands registered without `lazy()`, which appear only as `{ name, unresolved: true }` since no synchronous metadata is available for them), for tools that want to consume a CLI's help programmatically instead of parsing the formatted `--help` text. `extractFields`/`generateDoc` already exposed command metadata, but neither produced a JSON-safe DTO (both carry schema objects and callbacks that don't survive `JSON.stringify`) nor resolved the whole subcommand tree in one call.
