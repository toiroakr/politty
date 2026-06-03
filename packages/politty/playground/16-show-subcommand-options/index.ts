/**
 * 16-show-subcommand-options.ts - Example of displaying subcommand options together
 *
 * How to run:
 *   pnpx tsx playground/16-show-subcommand-options.ts --help
 *   pnpx tsx playground/16-show-subcommand-options.ts --help-all  # or -H
 *   pnpx tsx playground/16-show-subcommand-options.ts config get user.name
 *   pnpx tsx playground/16-show-subcommand-options.ts config set user.name "John"
 *   pnpx tsx playground/16-show-subcommand-options.ts config list -f json
 *   pnpx tsx playground/16-show-subcommand-options.ts config list --help
 *
 * --help-all displays subcommand options as well:
 *   Commands:
 *     config                      Manage configuration
 *     config get                  Get a config value
 *     config set                  Set a config value
 *     config list                 List all config values
 *       -f, --format <FORMAT>     Output format (default: "table")
 *       -g, --global              Show global configuration (default: false)
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
    global: arg(z.boolean().default(false), {
      alias: "g",
      description: "Show global configuration",
    }),
  }),
  run: (args) => {
    console.log(`Listing all config (format: ${args.format}, global: ${args.global}):`);
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

// remote command
export const remoteAddCommand = defineCommand({
  name: "add",
  description: "Add remote",
  args: z.object({
    name: arg(z.string(), { positional: true, description: "Remote name" }),
    url: arg(z.string(), { positional: true, description: "Remote URL" }),
  }),
  run: (args) => {
    console.log(`Adding remote: ${args.name} -> ${args.url}`);
  },
});

export const remoteRemoveCommand = defineCommand({
  name: "remove",
  description: "Remove remote",
  args: z.object({
    name: arg(z.string(), { positional: true, description: "Remote name" }),
    force: arg(z.boolean().default(false), { alias: "f", description: "Force deletion" }),
  }),
  run: (args) => {
    console.log(`Removing remote: ${args.name} (force: ${args.force})`);
  },
});

export const remoteCommand = defineCommand({
  name: "remote",
  description: "Manage remotes",
  subCommands: {
    add: remoteAddCommand,
    remove: remoteRemoveCommand,
  },
});

// Main command
export const cli = defineCommand({
  name: "git-like",
  description: "Example of displaying subcommand options together",
  subCommands: {
    config: configCommand,
    remote: remoteCommand,
  },
});

// --help-all flag can display subcommand options
if (process.argv[1]?.includes("16-show-subcommand-options")) {
  runMain(cli, { version: "1.0.0" });
}
