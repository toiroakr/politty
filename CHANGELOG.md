# politty

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
