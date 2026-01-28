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
      description: "Name to greet"
    }),

    // Option flag: --loud / -l
    loud: arg(z.boolean().default(false), {
      alias: "l",
      description: "Greet loudly"
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
- **[Recipes](./recipes.md)**: Testing techniques, error handling, configuration
