---
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Export `loadEnvFiles` and `EnvFileNotFoundError`. `loadEnvFiles(globalArgs, { argv? })` loads the files that the `envFile` options of a `globalArgs` schema name on the command line (`argv` defaults to `process.argv.slice(2)`), so a CLI that forwards an unknown subcommand to a plugin can put the variables in the plugin's environment first. It reads no file when help or the version is requested, and a missing required file throws `EnvFileNotFoundError` without applying any file.
