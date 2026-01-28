# politty

**politty** is a lightweight, type-safe CLI framework for Node.js built on **Zod v4**.

From simple scripts to complex CLI tools with subcommands, validation, and auto-generated help, you can build them all with a developer-friendly API.

## Features

- **Zod Native**: Use Zod schemas directly for argument definition and validation
- **Type Safety**: Full TypeScript support with automatic type inference for parsed arguments
- **Flexible Argument Definition**: Support for positional arguments, flags, aliases, arrays, and environment variable fallbacks
- **Subcommands**: Build Git-style nested subcommands (with lazy loading support)
- **Lifecycle Management**: Guaranteed `setup` → `run` → `cleanup` execution order
- **Signal Handling**: Proper SIGINT/SIGTERM handling with guaranteed cleanup execution
- **Auto Help Generation**: Automatically generate help text from definitions
- **Discriminated Union**: Support for mutually exclusive argument sets

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
$ my-cli build -o out -m
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
| `subCommands` | `Record<string, Command>?`    | Subcommands         |
| `setup`       | `(context) => Promise<void>?` | Setup hook          |
| `run`         | `(args) => T?`                | Run function        |
| `cleanup`     | `(context) => Promise<void>?` | Cleanup hook        |

### `runMain(command, options?)`

CLI entry point. Handles signals and calls `process.exit()`.

```typescript
runMain(command, {
  version: "1.0.0",    // Displayed with --version flag
  argv: process.argv,  // Custom argv
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

| Metadata      | Type       | Description                          |
| ------------- | ---------- | ------------------------------------ |
| `positional`  | `boolean?` | Treat as positional argument         |
| `alias`       | `string?`  | Short alias (e.g., `-v`)             |
| `description` | `string?`  | Argument description                 |
| `placeholder` | `string?`  | Placeholder shown in help            |
| `env`         | `string?`  | Environment variable name (fallback) |

## Documentation

For detailed documentation, see the `docs/` directory:

- [Getting Started](./docs/getting-started.md) - Installation and creating your first command
- [Essentials](./docs/essentials.md) - Core concepts explained
- [Advanced Features](./docs/advanced-features.md) - Subcommands, Discriminated Union
- [Recipes](./docs/recipes.md) - Testing, configuration, error handling
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

## License

MIT
