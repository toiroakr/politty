# @politty/zod-mini

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
