# politty

**politty** is a lightweight, type-safe CLI framework for Node.js built on **Zod v4**.

From simple scripts to complex CLI tools with subcommands, validation, and auto-generated help, you can build them all with a developer-friendly API.

## Features

- **Zod Native**: Use Zod schemas directly for argument definition and validation
- **Type Safety**: Full TypeScript support with automatic type inference for parsed arguments
- **Flexible Argument Definition**: Support for positional arguments, flags, aliases, arrays, and environment variable fallbacks
- **Nested Commands**: Build Git-style subcommands (with lazy loading support)
- **Lifecycle Management**: Guaranteed `setup` → `run` → `cleanup` execution order
- **Signal Handling**: Proper SIGINT/SIGTERM handling with guaranteed cleanup execution

## Documentation

- **[Getting Started](./getting-started.md)**: Installation and creating your first command
- **[Essentials](./essentials.md)**: Core concepts (arguments, validation, lifecycle) explained
- **[Advanced Features](./advanced-features.md)**: Subcommands, Discriminated Union, advanced features
- **[Recipes](./recipes.md)**: Practical examples for testing, configuration, error handling
- **[API Reference](./api-reference.md)**: Detailed API reference
- **[Doc Generation](./doc-generation.md)**: Automatic documentation generation with golden tests

## Quick Example

```typescript
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";

const command = defineCommand({
  name: "greet",
  args: z.object({
    name: arg(z.string(), { positional: true }),
    loud: arg(z.boolean().default(false), { alias: "l" }),
  }),
  run: ({ args }) => {
    const msg = `Hello, ${args.name}!`;
    console.log(args.loud ? msg.toUpperCase() : msg);
  },
});

runMain(command);
```

## License

MIT
