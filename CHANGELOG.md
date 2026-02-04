# politty

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
