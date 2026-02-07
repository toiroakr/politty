---
"politty": patch
---

feat: add global options support

- Added `globalArgs` option to `runMain` and `runCommand` for defining global options available to all subcommands
- Global options are merged with command-specific options (command options take precedence)
- Added `GlobalArgs` interface for declaration merging to provide type-safe global options
- Help output now includes a "Global Options" section when global args are defined
- Global options can be specified before subcommand name (e.g., `cli --verbose subcommand`)
- Extended `assertDocMatch` for documentation generation with global options and root command info:
  - Added `globalArgs` option to include Global Options section in documentation
  - Added `rootInfo` option with `title`, `version`, `description`, `installation`, `headerContent`, and `footerContent`
  - Root commands display full Global Options table
  - Subcommands display link to Global Options section ("See [Global Options](#global-options)")
