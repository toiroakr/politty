# politty

## 0.9.0

### Minor Changes

- b7c8ebc: Reduced installation size (2.9MB to approx. 630KB, approx. 78% reduction)
  - Excluded source maps (.map) from the distribution
  - Explicitly excluded build artifacts such as build cache (tsconfig.tsbuildinfo) using the files field
  - BREAKING: Discontinued CJS distribution and changed to ESM-only (loading via require() is no longer possible, removed .cjs and index.d.cts)

### Patch Changes

- dfd1241: Removed the `string-width` runtime dependency
  - Replaced it with a lightweight built-in implementation (using Node's `stripVTControlCharacters` for ANSI stripping) used by the Markdown renderer
  - `politty` now has zero runtime dependencies

## 0.8.0

### Minor Changes

- 16b8503: Make `files`-mode documentation fully generated (marker-free) by default and resolve template links by specificity.
  - **Fully generated `files` output by default (breaking).** `files`-mode generation no longer emits `<!-- politty:...:start/end -->` markers; each file is regenerated as a whole. With `targetCommands`, only files containing a target command are processed, but each is rebuilt in full. Set the new `customizable: true` option on `GenerateDocConfig` when you want to hand-edit the output and have politty preserve your edits via markers (in-place section updates). When `customizable` is set, a command whose generated output gains a section the file lacks is reported as a non-fatal warning (run with `POLITTY_DOCS_DOCTOR=true POLITTY_DOCS_UPDATE=true` to insert it, or leave it removed to opt the section out). `path`/`rootDoc` output still uses markers; `templates` remain marker-free.
  - **Specificity-based link resolution.** Cross-output links now point at the output that renders a command most specifically — a dedicated per-command page (`{{politty:command:config}}`) wins over a full-tree page (`{{politty:command}}`) for that command and its descendants, regardless of registration order.
  - Adds a `markerless` option to `DefaultRendererOptions`.

### Patch Changes

- eea3f6a: Add template-based documentation generation. A new `templates` option on `GenerateDocConfig` maps output paths to template files containing `{{politty:...}}` placeholders; the output is fully generated from the template and contains no politty markers. Templates can exclude specific placeholders with `politty.exclude` front matter.

## 0.7.0

### Minor Changes

- fc88d86: Add `onUnknownSubcommand` option to `runMain` for CLI plugin dispatch.

  When a positional argument is not a known subcommand at any level whose command exposes subcommands, the handler is invoked with the command path traversed so far (`commandPath`), the unknown name, and the args that follow it. Returning a number treats the command as handled and exits with that code; returning `undefined` falls back to the default unknown-subcommand/help behavior. This enables `gh`-style external plugin binaries at the root (`mycli foo` → `mycli-foo`) and nested under known subcommands (`mycli foo bar` → `mycli-foo-bar`). The handler is skipped for internal (`__*`) completion invocations.

  Also exports the `UnknownSubcommandHandler` type.

## 0.6.0

### Minor Changes

- 7167924: Add runtime dispatcher shell completion with fast static-worker paths.

  The default `completion <shell>` output now resolves the active CLI executable at completion time and uses bundled or cached static workers for fast bash, zsh, and fish completions. This keeps project-local binaries working with tools such as `direnv`, `mise`, and `node_modules/.bin`, while avoiding a JavaScript process on common warm completion paths.

  Politty-based CLIs can generate bundled workers with `generateBundledCompletionWorker()` from `politty/completion` or the `politty generate-worker` package-script CLI.

  Existing users:
  - Existing `eval "$(mycli completion bash)"` and `eval "$(mycli completion zsh)"` setup keeps working and now uses dispatcher mode by default.
  - Existing fish users can rerun `mycli completion fish --install` after upgrading to refresh the fish autoload file.
  - If you saved a generated static completion script and want the new dispatcher behavior, regenerate it with `mycli completion <shell>`.
  - If you prefer the previous command-tree script that does not resolve the active binary at TAB time, use `mycli completion <shell> --static`.

  New users:
  - Use `mycli completion bash`, `mycli completion zsh`, or `mycli completion fish --install` for the default dispatcher setup.
  - For published CLIs, generate and ship a bundled worker artifact with `politty generate-worker --bin dist/cli/index.mjs --program mycli --shell zsh --verify` to avoid first-TAB worker generation.
  - For package layouts that cannot be represented with package-relative worker paths, enable `bundledWorker.queryCommand` so the dispatcher can ask the CLI for `__completion-worker-path <shell>` on the miss path.

## 0.5.1

### Patch Changes

- 6c1a89e: Make generated shell completion scripts self-refresh when saved to disk. Existing eval-based setup keeps working, while static bash/zsh/fish completion files generated by this release can refresh themselves after the CLI binary changes.

## 0.5.0

### Minor Changes

- dc1afef: Add `completion.custom.resolve` for in-process JS dynamic completion. The resolver receives a `DynamicCompletionContext` (current word, shell, other parsed arg values, previously supplied values) and returns candidates synchronously or via Promise. Static shell scripts (bash/zsh/fish) now delegate to `<program> __complete --shell <shell>` whenever a field uses `resolve`; the generated bash delegate stays compatible with Bash 3.2. Specifying more than one of `choices`, `shellCommand`, `resolve`, or `expand` on the same field throws.

  Type-level note: `generateCandidates(context, { shell })` now returns `Promise<CandidateResult>` and takes a required second argument. `__complete`'s internal `run` is async. Callers using only the high-level `withCompletionCommand` flow are unaffected.

### Patch Changes

- bbbad4f: Add `completion.custom.expand` for value completion that is pre-enumerated at script-generation time and baked into the static shell script. The user supplies `dependsOn` (sibling arg names that must have static `choices` or an enum schema) and `enumerate(deps)`; politty walks the cartesian product of the dependsOn values, calls `enumerate` for each combination, and emits Bash 3.2-compatible scalar variables, a hoisted associative array (zsh), or an inline switch (fish) keyed on those values. No Node process is spawned at TAB time — the shell dispatches via a case lookup or indirect-expansion lookup, taking the same `<10ms` path as static `choices`. Specifying more than one of `choices`, `shellCommand`, `resolve`, or `expand` on the same field throws.

## 0.4.16

### Patch Changes

- 6f75710: Add auto-refresh for shell completion caches.

  Generated bash/zsh/fish scripts now embed a `# politty-bin-sig: <mtime>` header. The cache is regenerated automatically through two complementary paths:
  - A small rc-loader snippet (printed by `<program> completion <shell> --loader`) that bash/zsh source on every shell startup. It compares the binary's mtime against the cache header and rewrites the cache when they differ before sourcing it.
  - A detached `__refresh-completion` child that `runMain` spawns on every CLI invocation, keeping caches warm even when shells aren't restarted.

  For fish, the autoload file written by `<program> completion fish --install` ends with a self-rewriting block that runs on TAB and replaces itself when stale.

  New `--install` and `--loader` flags on the `completion` subcommand. New `WithCompletionOptions.cacheDir` and `WithCompletionOptions.programVersion`. Set `POLITTY_NO_COMPLETION_REFRESH=1` to disable the runMain background hook.

- 83ca319: Add a `negation` option for boolean fields. Set it to a string (e.g. `"disable-cache"`) to replace the default `--no-<name>` form with a custom name, to `true` to keep the default `--no-<name>` and advertise it in help/docs/completions, or to `false` to disable negation entirely (both the default `--no-*` and any custom name are rejected). An optional `negationDescription` renders a separate row in help and generated docs. Help output, generated documentation, and shell completions (bash/zsh/fish) all reflect the configuration. Non-boolean fields are rejected at the type level and at runtime.
- 98de327: Fix Windows path separators leaking into generated docs:
  - Cross-file Markdown links now use forward slashes (`commands/config.md#config`) instead of `commands\config.md`, so links render correctly on every Markdown renderer.
  - Index marker scopes embedded in `rootDoc` files (`<!-- politty:index:<path>:start -->`) are normalized too, so docs generated on Windows can be regenerated on macOS/Linux without silently skipping the index update.

- 5a10050: Fix typecheck failure under `@typescript/native-preview` ≥ 20260504.

  Zod's registry rewrites the meta type through `$replace<Meta, S>`, and newer TypeScript builds expand the generic `then` signature on `PromiseLike<void>` inside `effect`'s return type during that rewrite, producing a structural type that is no longer assignable to the original `ArgMeta`. The runtime value is unchanged, so `getArgMeta` now restores the static type at the boundary with a localized cast.

## 0.4.15

### Patch Changes

- 161151d: Add command alias support for subcommands. Commands can now define `aliases` in `defineCommand()` to allow invocation by alternative names. Aliases are displayed in help output, documentation, and shell completions, with validation to prevent conflicts.

## 0.4.14

### Patch Changes

- dbd71fe: Extend `alias` to accept `string | string[]`. Multi-character entries
  become additional long options (e.g. `alias: "to-be"` accepts both
  `--tobe` and `--to-be`), and arrays allow combining short and long
  aliases (`alias: ["v", "loud"]`). Kebab-case long aliases also accept
  their camelCase variant.

  Add `hiddenAlias` (same shape as `alias`) for names the parser should
  accept without surfacing them in help, generated docs, or shell
  completion — useful for legacy or deprecated option names.

## 0.4.13

### Patch Changes

- caa32e4: Add `politty/prompt` module for interactive missing-option prompts with TTY detection, discriminatedUnion support, and pluggable adapter interface. Ships with two adapters: `politty/prompt/clack` (@clack/prompts) and `politty/prompt/inquirer` (@inquirer/prompts).
- 1db0f98: Switch CI runner from ubuntu-slim to ubuntu-latest to fix knip memory allocation failure with oxc-parser
- 200ac28: Use FileConfig.title and description in deriveIndexFromFiles for index category generation
- 34ad15e: Use oxfmt JavaScript API instead of CLI subprocess for formatting in tests

## 0.4.12

### Patch Changes

- 2f5afbf: Add POLITTY_DOCS_DOCTOR mode to detect and insert missing section markers in existing documentation files

  Fix duplicate validation error display: remove direct error logging from runCommandInternal (programmatic API) and add displayErrors option to runMain for controlling error output

## 0.4.11

### Patch Changes

- bae8af4: Show description for empty xor variants in help output and generated docs instead of silently skipping them

## 0.4.10

### Patch Changes

- b908f86: Add dual-case (camelCase/kebab-case) access for command args in both types and runtime
- c2cecc3: Clear stale section marker content when generated output no longer includes the section (e.g., options emptied by globalArgs filtering). In check mode, stale markers are now reported as diffs, which may cause CI to fail if markers are out of sync.

## 0.4.9

### Patch Changes

- 5406787: Automatically clean up orphaned section markers for deleted commands in update mode. Wrap global options link with section marker so it is not silently dropped in section-level marker mode.

## 0.4.8

### Patch Changes

- 93d6618: Add `effect` callback to `arg()` metadata for executing side effects after argument parsing and validation. The effect `value` parameter is type-safe via Zod schema output type, and `EffectContext.globalArgs` provides typed access to global args (via declaration merging) in command arg effects.
- 6a07e83: Fix transform (pipe) schemas breaking flag detection by using correct Zod v4 `def.in` property and handling pipe type in `extractFields`

## 0.4.7

### Patch Changes

- ca62fe5: add global setup/cleanup hooks to runMain and runCommand options

## 0.4.6

### Patch Changes

- e3e5936: Support bidirectional camelCase/kebab-case CLI argument resolution. Fields defined in either case now accept CLI input in both formats. Also adds `--noCamelCase` and `--no-kebab-case` boolean negation and blocks the mixed `--no-camelCase` form. Includes collision-safe alias registration and `definedNames` guard that prevents field names starting with "no" from being misinterpreted as boolean negation.
- 14ed3c8: Add variant-aware markdown rendering for union, xor, and discriminatedUnion schemas in doc generation

## 0.4.5

### Patch Changes

- 00df8e4: Add runtime global options and documentation enhancements
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

## 0.4.4

### Patch Changes

- 0799021: Fix new subcommand insertion position in targetCommands mode. Previously, auto-expanded subcommands were appended to the end of the file instead of being inserted at the correct alphabetical position among siblings.

## 0.4.3

### Patch Changes

- 2082857: Fix stdout truncation when piped (e.g., `eval "$(cli completion zsh)"`)

  Drain stdout buffer before calling `process.exit()` in `runMain`. When stdout is a pipe, Node.js buffers writes asynchronously. Without draining, large outputs (such as shell completion scripts) could be truncated, causing shell syntax errors like `zsh: unmatched "`.

## 0.4.2

### Patch Changes

- f2145f2: feat(completion): add `matcher` glob pattern support for file filtering (e.g., `.env.*`)

## 0.4.1

### Patch Changes

- 763a1d9: Refactor shell completion to thin shell wrappers with `__complete` delegation and fix extension filtering
  - Refactor shell scripts (bash/zsh/fish) to thin wrappers that delegate to `__complete --shell={shell}`
  - Resolve shellCommand execution and file extension filtering in JS via `@ext:` metadata protocol
  - Fix zsh `_files -g` fallback showing all files when no extensions match (file-patterns zstyle)
  - Fix bash inline `--opt=value` completion, glob expansion, and stale COMPREPLY
  - Fix fish prefix completion bug (`commandline -ct` not always included)
  - Add `NoFileCompletion` directive for enum/choices value completions
  - Add comprehensive shell completion E2E tests across bash/zsh/fish (zpty, expect, complete --do-complete)
  - Split shell completion tests into per-shell vitest projects with CI matrix parallelization
  - Add shell completion guide documentation (`docs/shell-completion.md`)

## 0.4.0

### Minor Changes

- 73aa8c2: Replace command-level markers with section-level markers

  Markers have changed from `<!-- politty:command:<path>:start/end -->` to per-section markers like `<!-- politty:command:<scope>:heading:start/end -->`, `<!-- politty:command:<scope>:description:start/end -->`, etc.

  Index markers now include a scope parameter: `<!-- politty:index:<scope>:start/end -->`.

  This enables users to selectively customize individual sections (heading, description, usage, arguments, options, subcommands, examples, notes) by removing their markers, while keeping other sections auto-generated.

## 0.3.3

### Patch Changes

- eab1560: Fix table alignment in Markdown renderer when cells contain inline formatting (backticks, bold, italic) or full-width characters. Column widths are now calculated based on visual width using string-width instead of string length.

## 0.3.2

### Patch Changes

- eb25582: Add dynamic shell completion via `__complete` command
  - Add `__complete` command that outputs completion candidates at runtime
  - Support dynamic completion mode with `--dynamic` flag in completion command
  - Auto-include `__complete` in `withCompletionCommand()` by default
  - Add context-aware completion parsing for subcommands, options, and positional arguments
  - Support completion directives for file/directory completion

## 0.3.1

### Patch Changes

- 582600a: Add globalOptions and index marker support for documentation generation

## 0.3.0

### Minor Changes

- 7289e4d: Make `programName` parameter optional in `createCompletionCommand` and `withCompletionCommand`, defaulting to `rootCommand.name`

## 0.2.2

### Patch Changes

- b08beb5: Add markdown table syntax support to the terminal markdown renderer

## 0.2.1

### Patch Changes

- f447c8d: Add lightweight markdown renderer for styled terminal help notes with support for headings, lists, code blocks, blockquotes, and GitHub alert syntax
- 92f3dc3: Show required/optional status in options documentation output

## 0.2.0

### Minor Changes

- ac11f29: Auto-prepend full command path in documentation examples via `commandPrefix` option in `ExamplesRenderOptions`

### Patch Changes

- 11fa620: Fix zsh completion error when loading via eval by using compdef instead of direct function call

## 0.1.2

### Patch Changes

- 1d0fc53: Add `renderArgsTable` and `renderCommandIndex` functions for documentation generation.
  - `renderArgsTable`: Render args definitions (like `commonArgs`) as markdown options table
  - `renderCommandIndex`: Generate categorized command index tables with links to documentation

## 0.1.1

### Patch Changes

- 70d35f1: Export `parseArgv` function and related types (`ParsedArgv`, `ParserOptions`) from the main entry point.

## 0.1.0

### Minor Changes

- b4d3be6: Initial release of politty - A type-safe CLI framework built on Zod.

  Features:
  - Type-safe argument parsing with Zod schemas
  - Positional arguments and named options (flags)
  - Subcommands with infinite nesting and lazy loading
  - Lifecycle hooks (setup, run, cleanup)
  - Automatic help generation
  - Environment variable support
  - Discriminated union for mutually exclusive options
