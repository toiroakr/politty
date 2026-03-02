/**
 * 17-deep-nested-subcommands.ts - Example of 3+ level nested subcommands
 *
 * Structure:
 *   git-like
 *     └── config
 *           ├── user
 *           │     ├── get
 *           │     └── set
 *           └── core
 *                 ├── get
 *                 └── set
 *
 * How to run:
 *   pnpx tsx playground/17-deep-nested-subcommands.ts --help
 *   pnpx tsx playground/17-deep-nested-subcommands.ts config --help
 *   pnpx tsx playground/17-deep-nested-subcommands.ts config user --help
 *   pnpx tsx playground/17-deep-nested-subcommands.ts config user get --help
 *   pnpx tsx playground/17-deep-nested-subcommands.ts config user get name
 *   pnpx tsx playground/17-deep-nested-subcommands.ts config user set name "John Doe"
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// config user get command
export const configUserGetCommand = defineCommand({
  name: "get",
  description: "Get user config value",
  args: z.object({
    key: arg(z.string(), {
      positional: true,
      description: "Config key (name, email etc)",
    }),
  }),
  run: (args) => {
    const values: Record<string, string> = {
      name: "John Doe",
      email: "john@example.com",
    };
    console.log(`user.${args.key} = ${values[args.key] ?? "(not set)"}`);
  },
});

// config user set command
export const configUserSetCommand = defineCommand({
  name: "set",
  description: "Set user config value",
  args: z.object({
    key: arg(z.string(), {
      positional: true,
      description: "Config key",
    }),
    value: arg(z.string(), {
      positional: true,
      description: "Config value",
    }),
    global: arg(z.boolean().default(false), {
      alias: "g",
      description: "Save as global configuration",
    }),
  }),
  run: (args) => {
    const scope = args.global ? "global" : "local";
    console.log(`Setting user.${args.key} = ${args.value} (${scope})`);
  },
});

// config user command
export const configUserCommand = defineCommand({
  name: "user",
  description: "Manage user settings",
  subCommands: {
    get: configUserGetCommand,
    set: configUserSetCommand,
  },
});

// config core get command
export const configCoreGetCommand = defineCommand({
  name: "get",
  description: "Get core config value",
  args: z.object({
    key: arg(z.string(), {
      positional: true,
      description: "Config key (editor, pager etc)",
    }),
  }),
  run: (args) => {
    const values: Record<string, string> = {
      editor: "vim",
      pager: "less",
    };
    console.log(`core.${args.key} = ${values[args.key] ?? "(not set)"}`);
  },
});

// config core set command
export const configCoreSetCommand = defineCommand({
  name: "set",
  description: "Set core config value",
  args: z.object({
    key: arg(z.string(), {
      positional: true,
      description: "Config key",
    }),
    value: arg(z.string(), {
      positional: true,
      description: "Config value",
    }),
  }),
  run: (args) => {
    console.log(`Setting core.${args.key} = ${args.value}`);
  },
});

// config core command
export const configCoreCommand = defineCommand({
  name: "core",
  description: "Manage core settings",
  subCommands: {
    get: configCoreGetCommand,
    set: configCoreSetCommand,
  },
});

// config command
export const configCommand = defineCommand({
  name: "config",
  description: "Manage configuration",
  subCommands: {
    user: configUserCommand,
    core: configCoreCommand,
  },
});

// Main command
export const cli = defineCommand({
  name: "git-like",
  description: "Example of 3-level nested subcommands",
  subCommands: {
    config: configCommand,
  },
});

if (process.argv[1]?.includes("17-deep-nested-subcommands")) {
  runMain(cli, { version: "1.0.0" });
}
