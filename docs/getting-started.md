# Getting Started

## Installation

politty requires **Zod v4**.

```bash
npm install politty zod
# or
pnpm add politty zod
# or
yarn add politty zod
```

### Using valibot instead of Zod

politty is also published as [`@politty/valibot`](https://www.npmjs.com/package/@politty/valibot), built on [valibot](https://valibot.dev/) instead of Zod:

```bash
npm install @politty/valibot valibot
```

Everything in these docs applies unchanged — the exported API (`defineCommand`, `arg`, `runMain`, and the `docs` / `completion` / `skill` / `prompt` subpaths) and the `politty` bin are the same. Only two things differ:

- Import from `@politty/valibot` and write schemas with valibot (`v.object({ ... })`, `v.optional(v.boolean(), false)`, and `v.pipe(v.unknown(), v.transform(Number), v.number())` where the Zod examples use `z.coerce.number()`).
- Field descriptions can additionally come from valibot's own metadata actions, in place of `.describe()`. These are actions rather than schemas, so they go inside `v.pipe(...)`: `v.pipe(v.string(), v.description("..."))` or `v.pipe(v.string(), v.metadata({ description: "..." }))`. There is no `@politty/valibot/augment` subpath, because it exists only to augment Zod's `GlobalMeta` interface; use `arg()` or a piped `v.metadata(...)` instead. Extending `GlobalArgs` works the same way (`declare module "@politty/valibot"`).

A runnable example lives in [`playground/31-valibot`](https://github.com/toiroakr/politty/tree/main/playground/31-valibot).

## Your First Command

Here's a minimal "Hello World" example.

```typescript
import { defineCommand, runMain } from "politty";

const command = defineCommand({
  name: "my-cli",
  run: () => {
    console.log("Hello, World!");
  },
});

runMain(command);
```

You can run it locally with `tsx` or `ts-node`:

```bash
$ npx tsx index.ts
Hello, World!
```

## Adding Arguments

Use `z.object` and `arg()` to define arguments.

```typescript
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";

const command = defineCommand({
  name: "greet",
  args: z.object({
    // Positional argument: greet <name>
    name: arg(z.string(), {
      positional: true,
      description: "Name to greet",
    }),

    // Option flag: --loud / -l
    loud: arg(z.boolean().default(false), {
      alias: "l",
      description: "Greet loudly",
    }),
  }),
  run: (args) => {
    const message = `Hello, ${args.name}!`;
    console.log(args.loud ? message.toUpperCase() : message);
  },
});

runMain(command);
```

```bash
$ npx tsx greet.ts World
Hello, World!

$ npx tsx greet.ts World --loud
HELLO, WORLD!
```

## Next Steps

Now that you understand the basics, check out these guides for more details:

- **[Essentials](./essentials.md)**: Details on arguments, validation, and lifecycle hooks
- **[Advanced Features](./advanced-features.md)**: Subcommands, nested structures, complex schemas
- **[Recipes](./recipes.md)**: Testing techniques, error handling, configuration, and faster startup with the compile cache (`politty generate-shim`)
