# politty

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
