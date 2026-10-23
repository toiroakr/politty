# Essentials

This guide explains the core concepts you need to create CLI tools with **politty**.

## Arguments and Options

politty uses Zod schemas to define positional arguments and named options (flags) within a single object.

### Positional Arguments

Positional arguments are determined by position rather than name. Specify `{ positional: true }` in the `arg()` options.

**Important Rule:** The order of definitions within `z.object` directly determines the argument order.

### Defining Metadata

There are two ways to define argument metadata (description, positional flag, alias, etc.):

1. **`arg()`**: Wrap the schema with a helper function. This is the standard approach.
2. **`.meta()`**: Chain directly on the Zod schema. When using this method, `import "politty/augment";` is recommended for TypeScript type support.

```typescript
import "politty/augment"; // Required for .meta() type support
import { defineCommand, arg } from "politty";
import { z } from "zod";

const command = defineCommand({
  args: z.object({
    // Method 1: Using arg()
    source: arg(z.string(), {
      positional: true,
      description: "Source file",
    }),

    // Method 2: Using .meta()
    // Requires import "politty/augment"
    destination: z.string().meta({
      positional: true,
      description: "Destination file",
    }),
  }),
  // ...
});
```

The examples below primarily use `arg()`, but you can write the same with `.meta()`.

#### Multi-line descriptions

Descriptions may contain `\n` line breaks. They are rendered as real line breaks
everywhere a description appears:

- **Terminal help**: continuation lines are indented to stay aligned under the
  description column.
- **Generated Markdown** (tables and lists): line breaks are emitted as `<br>`
  so they render inside a single table cell / list item without breaking the
  surrounding structure.

```typescript
args: z.object({
  strategy: arg(z.string().default("rolling"), {
    alias: "s",
    description: "Rollout strategy.\nrolling: gradual replacement.\nrecreate: stop then start.",
  }),
});
```

```bash
$ my-cli src.txt dest.txt
```

#### Positional Argument Rules

1.  **Required before optional**: You cannot define a required positional argument after an optional one.
    - ✅ `required` → `optional`
    - ❌ `optional` → `required`
2.  **Arrays must be last**: Array positional arguments (e.g., `z.array(z.string())`) can be defined but **must be last**. They receive all remaining arguments.
3.  **No arrays with optional**: When using array positional arguments, you cannot combine them with other optional positional arguments (to avoid ambiguity).

#### Accepting a Positional as a Named Option

A positional argument is not accepted as `--<name>` by default. Pass `{ positional: { named: true } }` to accept both forms, for example so a value that starts with `-` can be passed as `--name=-dev`. Help and generated docs list it once under arguments as `<name>, --name <NAME>`, and shell completion offers `--name` as well.

```typescript
args: z.object({
  name: arg(z.string(), { positional: { named: true }, description: "Profile name" }),
});
```

```bash
$ my-cli dev
$ my-cli --name=-dev
```

When the value is given as `--name`, the next positional token fills the next positional argument instead.

### Named Options (Flags)

Arguments without `{ positional: true }` are treated as named options (flags).

```typescript
args: z.object({
  // --name="value"
  name: arg(z.string(), { description: "Name" }),

  // --verbose or -v (boolean flag)
  verbose: arg(z.boolean().default(false), {
    alias: "v",
    description: "Enable verbose logging",
  }),
});
```

- **Boolean flags**: Their presence alone is treated as `true` (e.g., `--verbose`).
- **Aliases**: Use `alias` to define short forms like `-v`. Multi-character entries become additional long options (e.g. `alias: "to-be"` accepts both `--tobe` and `--to-be`). Pass an array to combine short and long aliases: `alias: ["v", "loud"]`.
- **Hidden aliases**: Use `hiddenAlias` for names the parser should accept but that should not appear in help, generated docs, or shell completion (typical use: legacy or deprecated names).
- **Default values**: Use Zod's `.default()` to set fallback values.

### Array Options

Using `z.array()` allows the same option to be specified multiple times.

```typescript
args: z.object({
  include: arg(z.array(z.string()), {
    alias: "i",
    description: "Files to include",
  }),
});
```

```bash
$ my-cli --include file1.txt -i file2.txt
# args.include = ["file1.txt", "file2.txt"]
```

### Grouped Options (`unflatten`)

To receive related options as a nested object, declare them with dotted keys and wrap the schema with `unflatten`. Each key stays an ordinary option with its own `arg()` metadata (`alias`, `env`, `effect`, ...); only the validated value handed to `run` is nested.

```typescript
import { unflatten } from "@politty/zod";

args: unflatten(
  z.object({
    "config.serverPort": arg(z.coerce.number(), { alias: "p", env: "PORT" }),
    "config.host": z.string().default("localhost"),
  }),
);
```

```bash
$ my-cli --config.serverPort 8080   # or -p 8080, or PORT=8080
# args.config = { serverPort: 8080, host: "localhost" }
```

- Help and generated docs list the flat keys (`--config.server-port`); validation errors are reported at the flat key (`config.serverPort: ...`).
- A group exists only when one of its keys is present in the validated value.
- A key that is both a value and a group (`db` and `db.host`) throws a `TypeError` when the schema is built.
- `unflatten` is exported by `@politty/zod`, `@politty/zod-mini`, `@politty/valibot` and `@politty/loculus` (`@politty/loculus` needs `loculus` 0.4.0 or later).
- When `globalArgs` and a command both nest into the same group, the groups are merged key by key and the command's value wins for a key both declare. Use `unflatten` on both schemas in that case.
- Use it on the schema you pass as `args` (or `globalArgs`), and call it last: `.refine()`, `.optional()` and the like return a different schema object that politty does not recognize, so put such checks on the object you pass to `unflatten`. An `unflatten` schema as an option of a union is rejected when fields are extracted.

Keys written in kebab-case or camelCase are split only after the prefixes you list, so names such as `dry-run` and `dbx` stay whole:

```typescript
unflatten(
  z.object({
    "db-host": z.string(),
    "db-pool-max": z.coerce.number(),
    "dry-run": z.boolean().default(false),
  }),
  {
    style: "kebab",
    prefixes: ["db", "db-pool"],
  },
);
// { db: { host, pool: { max } }, "dry-run": false }
```

## Validation and Types

Since politty is built on Zod, you get powerful validation features out of the box.

### Type Coercion (`z.coerce`)

Command-line arguments are strings by default. Use `z.coerce` for automatic type conversion.

```typescript
args: z.object({
  // Convert "123" to number 123
  port: arg(z.coerce.number().default(3000)),

  // Convert "2023-01-01" to Date object
  date: arg(z.coerce.date()),
});
```

### Advanced Validation

You can also use Zod's refine methods and more.

```typescript
args: z.object({
  email: arg(z.string().email()),

  age: arg(z.coerce.number().min(18).max(100)),

  url: arg(z.string().url()),
});
```

Validation errors are automatically caught and displayed to users in a readable format.

## Lifecycle Hooks

`defineCommand` supports three lifecycle hooks:

1.  **`setup`**: Runs before the main process. Useful for initializing resources (DB connections, loading config).
2.  **`run`**: The main command process.
3.  **`cleanup`**: Runs after `run` completes, **even if an error occurred**. Ideal for closing connections or deleting temporary files.

```typescript
const command = defineCommand({
  setup: async ({ args }) => {
    console.log("Setting up...");
  },
  run: async (args) => {
    console.log("Running...");
    // throw new Error("Oops"); // cleanup still runs even if error here
  },
  cleanup: async ({ args, error }) => {
    console.log("Cleaning up...");
    if (error) console.error("An error occurred during execution:", error);
  },
});
```

The execution order `setup` → `run` → `cleanup` is always guaranteed.
