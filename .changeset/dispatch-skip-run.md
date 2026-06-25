---
"politty": patch
---

`onUnknownSubcommand` is no longer invoked for a command that defines its own `run`. Such a command's first positional is a real argument, so an installed `<cli>-<name>` plugin must never shadow it — which previously could make the command's meaning depend on what was on PATH. Plugin dispatch now only happens for pure subcommand-group commands (no `run`).
