---
"@politty/loculus": minor
"@politty/valibot": minor
"@politty/zod": minor
"@politty/zod-mini": minor
"politty": minor
---

Check the options given to a command group run without a subcommand before showing its help or running its `defaultSubCommand`. An invalid global option value, given as a flag or through its environment variable, now exits with 2 instead of printing the help, while a missing required global option still shows it. An unknown flag is rejected by a strict `unknownKeys` mode instead of being ignored. Other modes drop it with a warning (strip) or silently (passthrough) and then run the group as if it was not given, including its `defaultSubCommand`. A group without its own `args` reports flag-like tokens as unknown flags handled by the `globalArgs` schema's mode, instead of as unexpected positional arguments that left it printing nothing.
