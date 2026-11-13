---
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Export `loadEnvFiles` and `EnvFileNotFoundError`. `loadEnvFiles(globalArgs)` loads the files that the `envFile` options of a `globalArgs` schema name on the command line, so a CLI that forwards an unknown subcommand to a plugin can put the variables in the plugin's environment first.
