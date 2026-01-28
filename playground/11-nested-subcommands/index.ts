/**
 * 11-nested-subcommands.ts - Nested subcommands example
 *
 * How to run:
 *   pnpx tsx playground/11-nested-subcommands.ts --help
 *   pnpx tsx playground/11-nested-subcommands.ts config --help
 *   pnpx tsx playground/11-nested-subcommands.ts config get user.name
 *   pnpx tsx playground/11-nested-subcommands.ts config set user.name "John Doe"
 *   pnpx tsx playground/11-nested-subcommands.ts config list
 *   pnpx tsx playground/11-nested-subcommands.ts config list --format json
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// config get command
export const configGetCommand = defineCommand({
  name: "get",
  description: "Get a config value",
  args: z.object({
    key: arg(z.string(), {
      positional: true,
      description: "Config key",
    }),
  }),
  run: (args) => {
    console.log(`Getting config: ${args.key}`);
    // In practice, load config here
    console.log(`  Value: (simulated value for ${args.key})`);
  },
});

// config set command
export const configSetCommand = defineCommand({
  name: "set",
  description: "Set a config value",
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
    console.log(`Setting config: ${args.key} = ${args.value}`);
  },
});

// config list command
export const configListCommand = defineCommand({
  name: "list",
  description: "List all config values",
  args: z.object({
    format: arg(z.enum(["table", "json", "yaml"]).default("table"), {
      alias: "f",
      description: "Output format",
    }),
  }),
  run: (args) => {
    console.log(`Listing all config (format: ${args.format}):`);
    const config = {
      "user.name": "John",
      "user.email": "john@example.com",
      "core.editor": "vim",
    };
    if (args.format === "json") {
      console.log(JSON.stringify(config, null, 2));
    } else {
      for (const [key, value] of Object.entries(config)) {
        console.log(`  ${key} = ${value}`);
      }
    }
  },
});

// config command (has subcommands)
export const configCommand = defineCommand({
  name: "config",
  description: "Manage configuration",
  subCommands: {
    get: configGetCommand,
    set: configSetCommand,
    list: configListCommand,
  },
});

// Main command
export const cli = defineCommand({
  name: "git-like",
  description: "Git-style nested subcommand example",
  subCommands: {
    config: configCommand,
  },
});

if (process.argv[1]?.includes("11-nested-subcommands")) {
  runMain(cli, { version: "1.0.0" });
}
