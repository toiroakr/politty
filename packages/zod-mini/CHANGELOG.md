# @politty/zod-mini

## 0.5.1

### Patch Changes

- 3cc227e: Read the value of a value-taking short option attached to it (`-c5`) or combined with other short options (`-ac5`, `-ac 5`), instead of reading every character as a boolean flag. `parseArgv` does this for the options in its new `valueFlags` option.

  Read combined short options that are all global, such as `-vq` or `-n5`, as global options before and after a subcommand. Before, they stopped subcommand detection before a subcommand and were dropped after it. Combined short options that mix global and command options are still read by the command. Dynamic completion reads combined short options the same way.

  Read a negative number after a global option (`-n -5`, `--name -5`, `-vn -5`) as its value, as the command's own options already do. Before, it stopped subcommand detection before a subcommand and left the option without a value after it. Dynamic completion reads it the same way.

## 0.5.0

### Minor Changes

- 4d16b88: Check the options given to a command group run without a subcommand before showing its help or running its `defaultSubCommand`. An invalid global option value, given as a flag or through its environment variable, now exits with 2 instead of printing the help, while a missing required global option still shows it. An unknown flag is rejected by a strict `unknownKeys` mode instead of being ignored. Other modes drop it with a warning (strip) or silently (passthrough) and then run the group as if it was not given, including its `defaultSubCommand`. A group without its own `args` reports flag-like tokens as unknown flags handled by the `globalArgs` schema's mode, instead of as unexpected positional arguments that left it printing nothing. A group never reads the token after an unknown flag as the flag's value: `cli --bogus value` reports `value` as an unknown subcommand like `cli value`, `cli --dry-rn deploy` does not run the `defaultSubCommand`, and `cli --bogus=value` drops the flag with its value.

### Patch Changes

- 5a69178: Stop the `prompt/inquirer` resolver from submitting an argument's help `placeholder` (e.g. `FILE`) as its value when the user presses Enter on an empty text prompt. The placeholder is no longer passed to inquirer as `default`, so empty input gives `""` as with the `prompt/clack` resolver. inquirer has no hint-only option, so the inquirer prompt no longer shows the placeholder.

## 0.4.2

### Patch Changes

- d807ec7: Fix argument parsing and dynamic completion for discriminated unions nested inside ordinary unions. Retain compatible sibling branches and preserve named/positional argument roles and aliases when combining completion layouts.

  Use shared discriminator selection when prompting for missing arguments.

## 0.4.1

### Patch Changes

- a5699d5: Support optional external packages with `requiredPackages` declarations, argument-dependent activation (including boolean-option and discriminator metadata), installation guidance in help, and deferred loading from the consuming project. Automatically detect npm, pnpm, Yarn, or Bun to generate installation guidance when no explicit command is supplied. Preserve transitive dependency and initialization errors.

## 0.4.0

### Minor Changes

- 11225cc: Exit with code 2 instead of 1 when the command line is invalid: an unknown flag or subcommand, an unexpected positional argument, or arguments that fail validation. `runMain` exits with it and `runCommand` reports it as `exitCode`, so scripts and agents can tell a mistyped invocation from a command that failed while running, which still exits with 1. Code that checks for exit code 1 after an invalid command line needs to accept 2.

## 0.3.3

### Patch Changes

- df72c50: Treat an argument that accepts only boolean values as a boolean flag: `z.literal(true)`, `z.literal(false)`, `z.literal([true, false])`, a union of those or of `z.boolean()` with them, and their valibot counterparts. They previously had an unknown type, so a union option that defines such a flag no longer matched `--flag` given without a value and failed with `Arguments match none of the accepted forms.`, `--flag=false` was not read as `false`, and help and generated docs showed the flag as `--flag <FLAG>`.

## 0.3.2

### Patch Changes

- 4bd43b9: Detect AI coding agents (Claude Code, Codex, Cursor, Gemini CLI, ...) following the vercel/detect-agent spec. Adds `detectAgent()` on a new `agent` subpath, a `runMain`/`runCommand` `agentHelp` option that prepends agent-only guidance to `--help` (and adds it to `--help-json`), `args.$agent` in `run`/`setup`/`cleanup`, and `agent` in the global `setup`/`cleanup` contexts. Set `POLITTY_NO_AGENT=1` to opt out.

## 0.3.1

### Patch Changes

- 1b39c2c: List the built-in `--help` / `--help-all` / `--help-json` / `--version` options after the command's own options in the text `--help` output

## 0.3.0

### Minor Changes

- 0e16d6d: Stop accepting a positional argument as a long option. Previously `--name=dev` or `--name dev` silently filled a positional `name` (also through its kebab-case form, such as `--output-file` for `outputFile`); it is now reported as an unknown flag, which fails under a strict schema and warns under the default strip mode, and the positional stays unset.
- 99dc9e6: Read and show union arguments with the definition of the variant that applies. When variants of a discriminated union or union define the same argument differently (a positional in one, an option or a named positional in another), argv is now read with the variant the discriminator selects, or for a union with the first option whose definitions fit the tokens, instead of the first variant's definition. A union whose options all fail to fit now fails with `Arguments match none of the accepted forms. See --help for the accepted forms.` instead of the validator's generic union error; with a `prompt` resolver, a union option the tokens fit apart from missing required arguments is still selected when it is the only one, so the resolver can fill them. A discriminated union fails with the same error when its discriminator is given in a role only another variant uses. `--target` is accepted only by variants that define it as an option, and a positional token is no longer assigned to an argument the selected variant defines as an option. Help, `--help-json`, and generated docs list such an argument under each variant with that variant's role; shell completion offers `--target` when any variant accepts it, and dynamic completion follows the selected variant.

### Patch Changes

- a81bd6a: Add `positional: { named: true }` to accept a positional argument as a long option too, such as `--name=-dev` for a value that starts with `-`. Help and generated docs list it once under arguments as `<name>, --name <NAME>`, shell completion also offers `--name`, and when it is given as a long option the next positional token fills the next positional argument.

## 0.2.1

### Patch Changes

- 70e40ab: Show positional arguments and their descriptions in an `Arguments:` section of the text `--help` output, grouping union-variant-specific positionals under the same labels as options
- 32163de: fix(deps): update dependency yaml to ^2.9.1
- 3a2542c: chore(deps): update dependency @types/node to v25.9.7

## 0.2.0

### Minor Changes

- 33f8783: **Breaking change:** A field's `cliName` (its kebab-case name) or any long alias (`alias`/`hiddenAlias` entries longer than one character) can no longer be `help`, `help-all`, `help-json`, or `version`. These long flags are always intercepted by `parseArgs`/`scanForSubcommand` before schema parsing, regardless of which field produced the name, so an unguarded collision silently made that field unreachable. For a command's own `args` schema: `parseArgs()` now throws a `ReservedAliasError` for this collision; `runCommand()` catches it into `{ success: false, error }` instead of throwing; `runMain()` reports it and exits with a non-zero code instead of returning at all; and the explicit `validateCommand()` collects it into `{ valid: false, errors }` without throwing. For a `globalArgs` schema, `runCommand()`/`runMain()` validate it before entering the try/catch (or exit path) that produces those results, so a collision there becomes a rejected promise from `runCommand()`/`runMain()` itself instead (both are `async`, so the throw surfaces as promise rejection, not a synchronous throw at the call site). Unlike the existing reservation of the short aliases `-h`/`-H`, this has no `overrideBuiltinAlias: true` opt-in: the long flag is always resolved as the built-in before any field is consulted, so an override would only suppress the error without making the field reachable. Rename the colliding field or alias instead.

### Patch Changes

- ae9179c: Added a `--help-json` flag and a `generateHelpData(command, options?)` function that produce a structured, JSON-serializable representation of a command's help (name, description, positionals, options, discriminated-union/union variants, global options, examples, notes, and the full recursive subcommand tree — except legacy subcommands registered without `lazy()`, which appear only as `{ name, unresolved: true }` since no synchronous metadata is available for them), for tools that want to consume a CLI's help programmatically instead of parsing the formatted `--help` text. `extractFields`/`generateDoc` already exposed command metadata, but neither produced a JSON-safe DTO (both carry schema objects and callbacks that don't survive `JSON.stringify`) nor resolved the whole subcommand tree in one call.

## 0.1.5

### Patch Changes

- 6df1552: Fix the docs/help usage line rendering `<command>` (required) instead of `[command]` (optional) for a command group that has `defaultSubCommand` set but no `run`. `renderUsage()` (docs generator) and `renderUsageLine()` (CLI `--help`) both decided between `[command]` and `<command>` based solely on `command.run`, so a group that dispatches to its `defaultSubCommand` when invoked bare was documented as requiring an explicit subcommand even though it isn't. Both now also treat `defaultSubCommand` as "invocable without an explicit subcommand".

## 0.1.4

### Patch Changes

- 1e69ff0: Add a `defaultSubCommand` option to `defineCommand` for command groups that have `subCommands` but no `run`. When set to the name of a registered subcommand (checked at compile time — an unknown key is a type error), invoking the group with no subcommand specified runs that subcommand instead of showing help, correctly inheriting the parent's `globalArgs` values and `precedingArgs` (unlike a hand-rolled `runCommand(defaultCmd, [])` call, which would discard them). This exists for CLI plugin dispatch: `onUnknownSubcommand` skips any command that defines `run` (its first positional is a real argument, not a plugin target) — `defaultSubCommand` lets a group fall back to a runnable subcommand without exempting itself from plugin dispatch. Defining both `run` and `defaultSubCommand` on the same command, or pointing `defaultSubCommand` at a name that isn't a `subCommands` key, is now a validation error (`validateCommand()`, and a new throwing `validateDefaultSubCommand()`).

## 0.1.3

### Patch Changes

- 60f0d00: chore(deps): update pnpm to v12

## 0.1.2

### Patch Changes

- 783dcc9: Boolean-typed fields now accept the same literal set as Go's `strconv.ParseBool` (`1`/`t`/`T`/`TRUE`/`true`/`True` for true, `0`/`f`/`F`/`FALSE`/`false`/`False` for false) for both `--flag=value` CLI syntax and `env` fallbacks, matching the convention used by Docker, kubectl, Terraform, and GitHub Actions' `RUNNER_DEBUG`. Previously `env` fallbacks applied no coercion at all (a boolean field reading `env: "RUNNER_DEBUG"` would receive the raw string `"1"` and fail validation), and `--flag=value` only recognized `"true"`/`"false"`. Values outside this set are still passed through unchanged so validation reports the invalid input instead of silently guessing.

## 0.1.1

### Patch Changes

- f01148c: Fix `createLogCollector` (used by `executeExamples`/`assertDocMatch`) to also capture output written directly via `process.stdout.write` / `process.stderr.write`, not just `console.*` calls. Previously, a command that printed its primary output with `process.stdout.write` instead of `console.log` was invisible to `examples` verification — that output passed straight through to the real stdout and never showed up in the captured logs.

## 0.1.0

### Minor Changes

- bd9a8db: Add `@politty/zod-mini`: politty with `zod/mini` schemas. The new package exposes the same API surface as `@politty/zod` (`defineCommand`, `arg`, `runMain`, docs/completion/skill/prompt subpaths, and the `politty` bin), backed by a structural zod/mini validator adapter — the same `.def`-based introspection the classic zod adapter uses, with `.isOptional()`/`.description`/`.meta()` (unavailable on `zod/mini`) replaced by `.safeParse(undefined)` and reads from zod's `globalRegistry`. Field metadata comes from `arg()` as well as `.register(z.globalRegistry, {...})`. There is no `@politty/zod-mini/augment` module, matching `@politty/valibot`'s precedent — use `arg()` or the registry instead of the classic-only `GlobalMeta` augmentation.
