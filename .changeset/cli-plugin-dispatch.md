---
"politty": minor
---

Add `onUnknownSubcommand` option to `runMain` for CLI plugin dispatch.

When the first positional argument is not a known subcommand (and the root command exposes subcommands), the handler is invoked with the unknown name and the args that follow it. Returning a number treats the command as handled and exits with that code; returning `undefined` falls back to the default unknown-subcommand/help behavior. This enables `gh`-style external plugin binaries (e.g. `mycli foo` → `mycli-foo`). The handler is skipped for internal (`__*`) completion invocations.

Also exports the `UnknownSubcommandHandler` type.
