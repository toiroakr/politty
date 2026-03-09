---
"politty": patch
---

Add runtime global options and documentation enhancements

- Add `globalArgs` option to `runMain`/`runCommand` for runtime global options shared across all subcommands
- Add `createDefineCommand<TGlobalArgs>()` factory and `GlobalArgs` interface for type-safe global args access
- Add subcommand scanner to recognize global flags before/after subcommand position
- Add `Global Options:` section and `[global options]` usage line to help output
- Propagate global options to all subcommand levels in shell completion scripts
- Add `PathConfig` API as a simpler alternative to `files` for documentation output configuration
- Add `RootCommandInfo` for root document customization (title, description, header, footer)
- Auto-generate global options anchor and cross-file links in documentation
- Auto-derive `rootDoc.globalOptions` from `globalArgs` schema in `generateDoc`
- Validate global schema: reject duplicates, positional fields, and reserved aliases (`-h`/`-H`)
- Handle global/local flag collision (local takes precedence)
