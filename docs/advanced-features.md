# Advanced Features

## Subcommands

politty supports Git-style subcommands that can be infinitely nested or lazily loaded.

### Defining Subcommands

Use the `subCommands` property in `defineCommand`.

```typescript
const init = defineCommand({
  name: "init",
  run: () => console.log("Initializing..."),
});

const build = defineCommand({
  name: "build",
  run: () => console.log("Building..."),
});

const cli = defineCommand({
  name: "app",
  subCommands: {
    init,
    build,
  },
});
```

### Lazy Loading

For large CLIs, you can lazy-load subcommands to reduce startup time. Instead of directly importing commands, provide an async function that uses dynamic import (`import()`).

> **Note**: To benefit from lazy loading, you must use dynamic import (`import()`).
> Static imports at the top of the file (`import { ... } from "..."`) resolve modules immediately when the file is loaded, so they won't be lazily loaded.

```typescript
// ❌ Static import - resolves immediately when file is loaded
import { heavyCommand } from "./commands/heavy.js";

const cli = defineCommand({
  subCommands: {
    // heavyCommand is already loaded
    heavy: async () => heavyCommand,
  },
});
```

```typescript
// ✅ Dynamic import - loads only when subcommand is executed
const cli = defineCommand({
  subCommands: {
    heavy: async () => {
      const { heavyCommand } = await import("./commands/heavy.js");
      return heavyCommand;
    },
  },
});
```

See `playground/21-lazy-subcommands.ts` for a complete example.

### Nested Subcommands

Subcommands can have their own `subCommands`.

```typescript
const remoteAdd = defineCommand({ name: "add" /* ... */ });
const remoteRemove = defineCommand({ name: "remove" /* ... */ });

const remote = defineCommand({
  name: "remote",
  subCommands: {
    add: remoteAdd,
    rm: remoteRemove,
  },
});

const cli = defineCommand({
  subCommands: { remote },
});
```

```bash
$ my-cli remote add origin https://github.com/...
```

## Global Options

Global options are options that are available to all subcommands. This is useful for common options like `--verbose`, `--config`, or `--debug`.

### Defining Global Options

Define a global options schema and pass it to `runMain` or `runCommand`.

```typescript
import { z } from "zod";
import { arg, defineCommand, runMain } from "politty";

// Define global options schema
const globalArgsSchema = z.object({
  verbose: arg(z.boolean().default(false), {
    alias: "v",
    description: "Enable verbose output",
  }),
  config: arg(z.string().optional(), {
    alias: "c",
    description: "Path to configuration file",
  }),
});

const build = defineCommand({
  name: "build",
  args: z.object({
    output: arg(z.string().default("dist"), { alias: "o" }),
  }),
  run: (args) => {
    // Access global options (requires type setup - see below)
    console.log(`Building to ${args.output}`);
  },
});

const cli = defineCommand({
  name: "my-cli",
  subCommands: { build },
});

runMain(cli, {
  globalArgs: globalArgsSchema,
});
```

Usage:

```bash
# Global options can be specified before the subcommand
$ my-cli --verbose build --output dist
$ my-cli -v -c config.json build -o out
```

### Type-Safe Global Options

There are three patterns for type-safe global options access in subcommands.

#### Pattern 1: Declaration Merging (Project-wide)

Extend the `GlobalArgs` interface for automatic type inference across all commands.

```typescript
// global-args.ts
import { z } from "zod";
import { arg } from "politty";

export const globalArgsSchema = z.object({
  verbose: arg(z.boolean().default(false), { alias: "v" }),
  config: arg(z.string().optional(), { alias: "c" }),
});

// Extend GlobalArgs interface
declare module "politty" {
  interface GlobalArgs extends z.infer<typeof globalArgsSchema> {}
}
```

```typescript
// commands/build.ts
import { defineCommand } from "politty";

// No type parameter needed - GlobalArgs is automatically merged
export const buildCommand = defineCommand({
  name: "build",
  args: z.object({
    output: arg(z.string().default("dist")),
  }),
  run: (args) => {
    // args.verbose is typed automatically
    if (args.verbose) {
      console.log("Verbose mode enabled");
    }
  },
});
```

#### Pattern 2: createDefineCommand Factory (Recommended)

Use `createDefineCommand` to create a project-specific command factory with global args type pre-applied.

```typescript
// global-args.ts
import { z } from "zod";
import { arg, createDefineCommand } from "politty";

export const globalArgsSchema = z.object({
  verbose: arg(z.boolean().default(false), { alias: "v" }),
  config: arg(z.string().optional(), { alias: "c" }),
});

export type GlobalArgsType = z.infer<typeof globalArgsSchema>;

// Create a project-specific defineCommand
export const defineAppCommand = createDefineCommand<GlobalArgsType>();
```

```typescript
// commands/build.ts
import { defineAppCommand } from "../global-args.js";

// Use the factory-created function
export const buildCommand = defineAppCommand({
  name: "build",
  args: z.object({
    output: arg(z.string().default("dist")),
  }),
  run: (args) => {
    // args.verbose is typed via GlobalArgsType
    if (args.verbose) {
      console.log("Verbose mode enabled");
    }
  },
});
```

#### Pattern 3: Explicit Type Parameter

For one-off commands or when you need different global args per command.

```typescript
const buildCommand = defineCommand<
  typeof buildArgsSchema,
  void,
  GlobalArgsType // Third type parameter
>({
  name: "build",
  args: buildArgsSchema,
  run: (args) => {
    // args.verbose is typed
  },
});
```

### Help Output

When global options are defined, the help output includes a "Global Options" section.

```
$ my-cli --help

my-cli

Usage: my-cli [command]

Options:
  -h, --help                      Show help
  -H, --help-all                  Show help with all subcommand options

Global Options:
  -v, --verbose                   Enable verbose output (default: false)
  -c, --config <CONFIG>           Path to configuration file

Commands:
  build                           Build the project
```

## Complex Schemas

### Discriminated Union (Mutually Exclusive Options)

Use `z.discriminatedUnion` to create mutually exclusive argument sets. This is ideal for commands where a "mode" argument determines which other arguments are valid (and required).

```typescript
const args = z
  .discriminatedUnion("mode", [
    // Mode 1: File input
    z
      .object({
        mode: z.literal("file"),
        path: arg(z.string(), { description: "Input file path" }),
      })
      .describe("Input from file"),
    // Mode 2: URL input
    z
      .object({
        mode: z.literal("url"),
        url: arg(z.string().url(), { description: "Input URL" }),
        method: arg(z.enum(["GET", "POST"]).default("GET")),
      })
      .describe("Input from URL"),
  ])
  .describe("Input mode");

const command = defineCommand({
  args,
  run: (args) => {
    if (args.mode === "file") {
      // args.path is valid here
      console.log("Reading file:", args.path);
    } else {
      // args.url is valid here
      console.log("Fetching URL:", args.url);
    }
  },
});
```

#### Setting Descriptions

- **`.describe()` on the entire discriminatedUnion**: Used as the description for the discriminator field (`--mode` in this example)
- **`.describe()` on each variant**: Displayed in the help message for each variant's section

Help text is automatically grouped by variant:

```
Options:
  --mode <file|url>           Input mode

When mode=file: Input from file
    --path <PATH>             Input file path (required)

When mode=url: Input from URL
    --url <URL>               Input URL (required)
    --method <METHOD>         (default: "GET")
```

### Intersection (Schema Composition)

Use `.and()` or `z.intersection()` to combine schemas and reuse common options.

```typescript
const sharedOptions = z.object({
  verbose: arg(z.boolean().default(false), { alias: "v" }),
  json: arg(z.boolean().default(false)),
});

const command = defineCommand({
  args: sharedOptions.and(
    z.object({
      input: arg(z.string(), { positional: true }),
    }),
  ),
  run: (args) => {
    // args has verbose, json, and input
  },
});
```

## Transformations

Use Zod's `transform` to process arguments before they reach the handler.

```typescript
args: z.object({
  // Convert comma-separated string to array
  tags: arg(
    z.string().transform((val) => val.split(",")),
    { description: "Comma-separated tags" },
  ),
});
```

## Appendix: Extending Zod Global Registry

Normally, metadata is managed through the `arg()` function, but you can also extend Zod's global type definition to store metadata directly in `_def`.

### Using Zod `.meta()`

By importing `politty/augment`, you can use Zod's standard `.meta()` method to define argument metadata. This allows for cleaner definitions without the `arg()` helper.

```typescript
import "politty/augment"; // Required: Enable .meta() type extension (TypeScript only)
import { z } from "zod";
import { defineCommand } from "politty";

const command = defineCommand({
  args: z.object({
    name: z.string().meta({
      positional: true,
      description: "User name",
    }),
    verbose: z.boolean().meta({
      alias: "v",
      description: "Verbose mode",
    }),
  }),
  run: (args) => {
    // ...
  },
});
```

This feature is implemented by extending Zod's `GlobalMeta` interface.
