# politty

**politty** is a lightweight, type-safe CLI framework for Node.js built on **Zod v4**.

From simple scripts to complex CLI tools with subcommands, validation, and auto-generated help, you can build them all with a developer-friendly API.

## Features

- **Zod Native**: Use Zod schemas directly for argument definition and validation
- **Type Safety**: Full TypeScript support with automatic type inference for parsed arguments
- **Flexible Argument Definition**: Support for positional arguments, flags, aliases, arrays, and environment variable fallbacks
- **Subcommands**: Build Git-style nested subcommands (with lazy loading and alias support)
- **Lifecycle Management**: Guaranteed `setup` → `run` → `cleanup` execution order
- **Signal Handling**: Proper SIGINT/SIGTERM handling with guaranteed cleanup execution
- **Auto Help Generation**: Automatically generate help text from definitions
- **Interactive Prompts**: Prompt for missing arguments with pluggable adapters (clack, inquirer)
- **Discriminated Union**: Support for mutually exclusive argument sets
- **Skill Management**: Manage agent skills (SKILL.md) with file-based install/uninstall

## Requirements

- Node.js >= 18
- Zod >= 4.2.1

## Installation

```bash
npm install politty zod
# or
pnpm add politty zod
# or
yarn add politty zod
```

## Quick Start

```typescript
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";

const command = defineCommand({
  name: "greet",
  description: "A CLI tool that displays greetings",
  args: z.object({
    name: arg(z.string(), {
      positional: true,
      description: "Name of the person to greet",
    }),
    greeting: arg(z.string().default("Hello"), {
      alias: "g",
      description: "Greeting phrase",
    }),
    loud: arg(z.boolean().default(false), {
      alias: "l",
      description: "Output in uppercase",
    }),
  }),
  run: (args) => {
    let message = `${args.greeting}, ${args.name}!`;
    if (args.loud) {
      message = message.toUpperCase();
    }
    console.log(message);
  },
});

runMain(command);
```

Example usage:

```bash
$ my-cli World
Hello, World!

$ my-cli World -g "Hi" -l
HI, WORLD!

$ my-cli --help
Usage: greet <name> [options]

A CLI tool that displays greetings

Arguments:
  name    Name of the person to greet

Options:
  -g, --greeting <value>  Greeting phrase (default: "Hello")
  -l, --loud              Output in uppercase
  -h, --help              Show help
```

## Basic Usage

### Defining Arguments

Use the `arg()` function to define argument metadata:

```typescript
import { z } from "zod";
import { arg, defineCommand } from "politty";

const command = defineCommand({
  name: "example",
  args: z.object({
    // Positional argument (required)
    input: arg(z.string(), {
      positional: true,
      description: "Input file",
    }),

    // Optional positional argument
    output: arg(z.string().optional(), {
      positional: true,
      description: "Output file",
    }),

    // Flag (with alias)
    verbose: arg(z.boolean().default(false), {
      alias: "v",
      description: "Verbose output",
    }),

    // Environment variable fallback
    apiKey: arg(z.string().optional(), {
      env: "API_KEY",
      description: "API key",
    }),

    // Array argument (--file a.txt --file b.txt)
    files: arg(z.array(z.string()).default([]), {
      alias: "f",
      description: "Files to process",
    }),
  }),
  run: (args) => {
    console.log(args);
  },
});
```

### Subcommands

Define Git-style subcommands:

```typescript
import { z } from "zod";
import { arg, defineCommand, runMain } from "politty";

const initCommand = defineCommand({
  name: "init",
  description: "Initialize a project",
  aliases: ["i"],
  args: z.object({
    template: arg(z.string().default("default"), {
      alias: "t",
      description: "Template name",
    }),
  }),
  run: (args) => {
    console.log(`Initializing with template: ${args.template}`);
  },
});

const buildCommand = defineCommand({
  name: "build",
  description: "Build the project",
  aliases: ["b"],
  args: z.object({
    output: arg(z.string().default("dist"), {
      alias: "o",
      description: "Output directory",
    }),
    minify: arg(z.boolean().default(false), {
      alias: "m",
      description: "Minify output",
    }),
  }),
  run: (args) => {
    console.log(`Building to: ${args.output}`);
  },
});

const cli = defineCommand({
  name: "my-cli",
  description: "Example CLI with subcommands",
  subCommands: {
    init: initCommand,
    build: buildCommand,
  },
});

runMain(cli, { version: "1.0.0" });
```

Example usage:

```bash
$ my-cli init -t react
$ my-cli i -t react        # alias for init
$ my-cli build -o out -m
$ my-cli b -o out -m        # alias for build
$ my-cli --help
```

### Lifecycle Hooks

Execute hooks in `setup` → `run` → `cleanup` order. The `cleanup` hook is always executed, even if an error occurs:

```typescript
const command = defineCommand({
  name: "db-query",
  description: "Execute database queries",
  args: z.object({
    database: arg(z.string(), {
      alias: "d",
      description: "Database connection string",
    }),
    query: arg(z.string(), {
      alias: "q",
      description: "SQL query",
    }),
  }),
  setup: async ({ args }) => {
    console.log("[setup] Connecting to database...");
    // Establish DB connection
  },
  run: async (args) => {
    console.log("[run] Executing query...");
    // Execute query
    return { rowCount: 42 };
  },
  cleanup: async ({ args, error }) => {
    console.log("[cleanup] Closing connection...");
    if (error) {
      console.error(`Error occurred: ${error.message}`);
    }
    // Close connection
  },
});
```

## API

### `defineCommand(options)`

Define a command.

| Option        | Type                          | Description         |
| ------------- | ----------------------------- | ------------------- |
| `name`        | `string`                      | Command name        |
| `description` | `string?`                     | Command description |
| `args`        | `ZodSchema`                   | Argument schema     |
| `aliases`     | `string[]?`                   | Command aliases     |
| `subCommands` | `Record<string, Command>?`    | Subcommands         |
| `setup`       | `(context) => Promise<void>?` | Setup hook          |
| `run`         | `(args) => T?`                | Run function        |
| `cleanup`     | `(context) => Promise<void>?` | Cleanup hook        |

### `runMain(command, options?)`

CLI entry point. Handles signals and calls `process.exit()`.

```typescript
runMain(command, {
  version: "1.0.0", // Displayed with --version flag
  argv: process.argv, // Custom argv
});
```

### `runCommand(command, argv, options?)`

Programmatic/testing entry point. Does not call `process.exit()` and returns a result object.

```typescript
const result = await runCommand(command, ["arg1", "--flag"]);
if (result.success) {
  console.log(result.result);
} else {
  console.error(result.error);
}
```

### `arg(schema, meta)`

Attach metadata to an argument.

| Metadata      | Type          | Description                                                              |
| ------------- | ------------- | ------------------------------------------------------------------------ |
| `positional`  | `boolean?`    | Treat as positional argument                                             |
| `alias`       | `string?`     | Short alias (e.g., `-v`)                                                 |
| `description` | `string?`     | Argument description                                                     |
| `placeholder` | `string?`     | Placeholder shown in help                                                |
| `env`         | `string?`     | Environment variable name (fallback)                                     |
| `completion`  | `object?`     | Shell completion configuration                                           |
| `prompt`      | `PromptMeta?` | Interactive prompt configuration ([docs](./docs/interactive-prompts.md)) |

## Shell Completion

politty provides automatic shell completion generation for bash, zsh, and fish.

### Quick Setup

Use `withCompletionCommand` to add completion support to your CLI:

```typescript
import { defineCommand, runMain, withCompletionCommand } from "politty";

const mainCommand = withCompletionCommand(
  defineCommand({
    name: "mycli",
    subCommands: {
      build: buildCommand,
      test: testCommand,
    },
  }),
);

runMain(mainCommand);
```

Then users can enable completions:

```bash
# Bash
eval "$(mycli completion bash)"

# Zsh
eval "$(mycli completion zsh)"

# Fish
mycli completion fish | source
```

### Value Completion

Define completion hints for arguments:

```typescript
const command = defineCommand({
  name: "build",
  args: z.object({
    // Auto-detected from z.enum()
    format: arg(z.enum(["json", "yaml", "xml"]), {
      alias: "f",
      description: "Output format",
    }),

    // File completion
    config: arg(z.string(), {
      completion: { type: "file", extensions: ["json", "yaml"] },
    }),

    // Directory completion
    outputDir: arg(z.string(), {
      completion: { type: "directory" },
    }),

    // Custom shell command
    branch: arg(z.string().optional(), {
      completion: {
        custom: { shellCommand: "git branch --format='%(refname:short)'" },
      },
    }),

    // Static choices
    environment: arg(z.string(), {
      completion: {
        custom: { choices: ["development", "staging", "production"] },
      },
    }),
  }),
  run: (args) => {
    /* ... */
  },
});
```

## Skill Management

politty manages SKILL.md-based agent skills distributed via npm packages.

### Quick Setup

Use `withSkillCommand` to add skill management to your CLI:

```typescript
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "politty";
import { withSkillCommand } from "politty/skill";

// Resolves to ../skills from both src/ and dist/
const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), "../skills");

const cli = withSkillCommand(
  defineCommand({
    name: "my-agent",
    subCommands: {
      /* ... */
    },
  }),
  { sourceDir, package: "@my-agent/skills" },
);

runMain(cli);
```

`package` identifies who owns these skills. It is combined with the command name as `"{package}:{cliName}"` and must match the `metadata["politty-cli"]` stamp pre-declared in each source SKILL.md — `skills add`/`sync` refuse mismatches, and `remove`/`sync` refuse to delete skills belonging to another tool. The default install mode is `"symlink"` (`.agents/skills/<name>` -> source, `.claude/skills/<name>` -> canonical), so source updates propagate live; on filesystems without symlink support (e.g. Windows without Developer Mode) install throws with guidance to retry with `mode: "copy"`, which recursively copies instead (source updates then require re-running `sync`). See [Skill Management](./docs/skill-management.md) for details.

Skills are SKILL.md files with YAML frontmatter (spec-compliant: https://agentskills.io/specification). The `metadata["politty-cli"]` stamp is authored by the skill package:

```markdown
---
name: commit
description: Git commit message generation
license: MIT
metadata:
  politty-cli: "@my-agent/skills:my-agent"
---

# Instructions for the agent...
```

Then users can manage skills:

```bash
my-agent skills sync              # Remove and reinstall all skills
my-agent skills add commit        # Install a specific skill
my-agent skills remove commit     # Remove a specific skill
my-agent skills list              # List available skills
```

## Documentation

For detailed documentation, see the `docs/` directory:

- [Getting Started](./docs/getting-started.md) - Installation and creating your first command
- [Essentials](./docs/essentials.md) - Core concepts explained
- [Advanced Features](./docs/advanced-features.md) - Subcommands, Discriminated Union
- [Interactive Prompts](./docs/interactive-prompts.md) - Prompt for missing arguments interactively
- [Recipes](./docs/recipes.md) - Testing, configuration, error handling
- [Skill Management](./docs/skill-management.md) - Agent skill management (SKILL.md-based)
- [API Reference](./docs/api-reference.md) - Detailed API reference
- [Doc Generation](./docs/doc-generation.md) - Automatic documentation generation

## Examples

The `playground/` directory contains many examples:

- `01-hello-world` - Minimal command configuration
- `02-greet` - Positional arguments and flags
- `03-array-args` - Array arguments
- `05-lifecycle-hooks` - Lifecycle hooks
- `10-subcommands` - Subcommands
- `12-discriminated-union` - Discriminated Union
- `21-lazy-subcommands` - Lazy loading
- `26-command-alias` - Command aliases

## License

MIT
