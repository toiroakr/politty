---
"politty": minor
---

Add `onUnknownSubcommand` option to `runMain` for CLI plugin dispatch.

When a positional argument is not a known subcommand at any level whose command exposes subcommands, the handler is invoked with the command path traversed so far (`commandPath`), the unknown name, and the args that follow it. Returning a number treats the command as handled and exits with that code; returning `undefined` falls back to the default unknown-subcommand/help behavior. This enables `gh`-style external plugin binaries at the root (`mycli foo` → `mycli-foo`) and nested under known subcommands (`mycli foo bar` → `mycli-foo-bar`). The handler is skipped for internal (`__*`) completion invocations.

Also exports the `UnknownSubcommandHandler` type.
