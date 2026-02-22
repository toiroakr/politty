# politty

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
