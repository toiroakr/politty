# Interactive Prompts

politty can interactively prompt users for missing argument values. When a CLI argument is not provided via the command line or environment variables, the prompt module asks the user to enter it before validation runs.

## Quick Start

1. Install your preferred prompt adapter alongside politty:

```bash
# Using @clack/prompts
pnpm add @clack/prompts

# Using @inquirer/prompts
pnpm add @inquirer/prompts
```

2. Import the adapter and pass it to `runMain`:

```typescript
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";
import { prompt } from "politty/prompt/clack";
// or: import { prompt } from "politty/prompt/inquirer";

const command = defineCommand({
  name: "deploy",
  args: z.object({
    target: arg(z.string(), {
      description: "Deployment target",
      prompt: { message: "Where do you want to deploy?" },
    }),
  }),
  run: (args) => {
    console.log(`Deploying to ${args.target}...`);
  },
});

runMain(command, { prompt });
```

If the user runs `deploy` without `--target`, they will be prompted interactively.

## Adapters

politty ships with two built-in adapters. Each is in its own subpath so only the adapter you use is loaded.

| Adapter  | Import                    | Library                                                              |
| -------- | ------------------------- | -------------------------------------------------------------------- |
| clack    | `politty/prompt/clack`    | [@clack/prompts](https://www.npmjs.com/package/@clack/prompts)       |
| inquirer | `politty/prompt/inquirer` | [@inquirer/prompts](https://www.npmjs.com/package/@inquirer/prompts) |

Both are **optional peer dependencies** -- install only the one you need.

## Configuring Prompts on Arguments

Add a `prompt` field to `arg()` metadata to enable interactive prompting for that argument:

```typescript
args: z.object({
  // Simple: prompt with auto-detected type
  name: arg(z.string(), {
    description: "User name",
    prompt: {},
  }),

  // Custom message
  email: arg(z.string(), {
    prompt: { message: "Enter your email address" },
  }),

  // Password (masked input)
  token: arg(z.string(), {
    prompt: { type: "password", message: "Enter API token" },
  }),

  // Select from choices
  region: arg(z.string(), {
    prompt: {
      type: "select",
      choices: ["us-east-1", "eu-west-1", "ap-northeast-1"],
    },
  }),

  // Disable prompting for a specific field
  cached: arg(z.string().optional(), {
    prompt: { enabled: false },
  }),
});
```

### `PromptMeta` Options

| Property  | Type                                                | Description                                                                |
| --------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| `message` | `string`                                            | Message shown to the user. Defaults to the field's `description` or name   |
| `type`    | `PromptType`                                        | Explicit prompt type. Overrides auto-detection                             |
| `choices` | `Array<string \| { label: string; value: string }>` | Choices for select prompts. Overrides enum values from schema              |
| `enabled` | `boolean`                                           | Set to `false` to disable prompting (default: `true` when `prompt` is set) |

### Prompt Type Auto-Detection

When `type` is not explicitly set, the prompt type is resolved automatically:

| Priority | Source                   | Resolved Type                         |
| -------- | ------------------------ | ------------------------------------- |
| 1        | Explicit `prompt.type`   | As specified                          |
| 2        | `prompt.choices` present | `select`                              |
| 3        | `completion.type`        | `file` or `directory`                 |
| 4        | `z.enum()` schema        | `select` (enum values become choices) |
| 5        | `z.boolean()` schema     | `confirm`                             |
| 6        | Fallback                 | `text`                                |

## Prompting Flow

The prompt module runs after CLI parsing and environment variable resolution, but before Zod validation:

```
CLI args → env fallback → interactive prompts → Zod validation
```

Only fields that meet **all** of these conditions are prompted:

- The field has `prompt` metadata set (with `enabled !== false`)
- The current value is `undefined` (not provided via CLI or env)
- The field is not an array type (arrays are not supported for prompting)

In non-interactive environments (no TTY, CI detected, or `POLITTY_NO_PROMPT` env var set), prompting is skipped entirely and `rawArgs` is returned unchanged.

## Discriminated Unions

When using `z.discriminatedUnion()`, the prompt module handles it intelligently:

1. Prompts the **discriminator field** first (as a `select` with all variant values)
2. Narrows to the **active variant** based on the selected value
3. Prompts only the **active variant's fields** (excluding the discriminator)

```typescript
const command = defineCommand({
  name: "notify",
  args: z.discriminatedUnion("channel", [
    z.object({
      channel: arg(z.literal("email"), {
        prompt: { message: "Notification channel" },
      }),
      to: arg(z.string(), {
        prompt: { message: "Recipient email" },
      }),
    }),
    z.object({
      channel: arg(z.literal("slack"), {
        prompt: { message: "Notification channel" },
      }),
      webhook: arg(z.string(), {
        prompt: { message: "Slack webhook URL" },
      }),
    }),
  ]),
  run: (args) => {
    // ...
  },
});
```

If the user selects `"email"`, only `to` is prompted. If `"slack"`, only `webhook` is prompted.

> **Note:** Plain `z.union()` schemas skip prompting entirely because prompting a merged field set could cause silent data loss or validation errors.

## Custom Adapters

You can implement the `PromptAdapter` interface to use any prompt library:

```typescript
import { promptMissingArgs } from "politty/prompt";
import type { PromptAdapter } from "politty/prompt";
import type { PromptResolver } from "politty";

const myAdapter: PromptAdapter = {
  text: async ({ message, placeholder }) => {
    // Return user input string, or a symbol to indicate cancellation
  },
  password: async ({ message }) => {
    // Return masked input string
  },
  confirm: async ({ message }) => {
    // Return boolean
  },
  select: async ({ message, options }) => {
    // options: Array<{ label: string; value: string }>
    // Return selected value string
  },
  isCancelled: (value) => {
    // Return true if the value represents user cancellation
  },
};

export const prompt: PromptResolver = (rawArgs, extracted) =>
  promptMissingArgs(rawArgs, extracted, { adapter: myAdapter });
```

Then pass it to `runMain` as usual:

```typescript
runMain(command, { prompt });
```

## Disabling Prompts

| Method                                       | Scope                 |
| -------------------------------------------- | --------------------- |
| Omit `prompt` option from `runMain`          | All fields            |
| Set `POLITTY_NO_PROMPT=1` env var            | All fields (runtime)  |
| Set `prompt: { enabled: false }` on a field  | Single field          |
| Pass `interactive: false` in `PromptOptions` | Programmatic override |
