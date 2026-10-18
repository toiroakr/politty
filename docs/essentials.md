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

### Nested Object Options

An object field is expanded into one option per property, named by its
dotted path. Values are passed to `run` nested under the field again and
validated by the object's own schema (refinements included). Nested objects
are expanded recursively.

```typescript
args: z.object({
  config: z
    .object({
      serverPort: arg(z.coerce.number(), { alias: "p", env: "PORT" }),
      host: z.string().default("localhost"),
    })
    .optional(),
});
```

```bash
$ my-cli --config.server-port 8080   # or --config.serverPort 8080
# args.config = { serverPort: 8080, host: "localhost" }
```

An optional object stays `undefined` until one of its options is given. A
required object is always created, so its properties' defaults apply even
when none of its options is given. Set `arg()` metadata such as `alias`,
`env` or `effect` on the properties: on an object field itself, only
`description` and `flatten` are accepted.

`flatten` picks how keys are joined into option names (default: `"dot"`). A
nested object without its own `flatten` inherits the style of the object
containing it.

| `flatten` | Shown in help, docs and completion | Also accepted          |
| --------- | ---------------------------------- | ---------------------- |
| `"dot"`   | `--config.server-port`             | `--config.serverPort`  |
| `"kebab"` | `--config-server-port`             | `--configServerPort`   |
| `"camel"` | `--configServerPort`               | `--config-server-port` |

```typescript
config: arg(z.object({ serverPort: z.coerce.number() }), { flatten: "kebab" }),
```

An option that has the same name as another field (e.g. `--config-port` next
to a `configPort` field) is reported as a duplicate field.

Schemas whose expanded options could not be given as expected are rejected
when fields are extracted:

- An object field cannot have a default (`.default(...)`): give its
  properties defaults instead.
- A property cannot have an `effect` or `requiredPackages` when an enclosing
  object has a transform (or pipes into another schema), as the transform may
  change the value they read. Refinements are fine.
- An object field cannot be defined by more than one intersection member,
  nor by a union (or discriminated union) inside an intersection: put the
  fields the intersection adds into each union option instead.
- In a plain union, a required object needs at least one required property
  (or make it optional, or use a discriminated union): a union cannot tell
  which option's objects to create from their defaults.

When the global args and a command both expand an object of the same name,
`run` receives both objects merged property by property, with the command's
values taking precedence.

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
