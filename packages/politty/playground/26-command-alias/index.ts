/**
 * 26-command-alias.ts - Command alias example
 *
 * Demonstrates how to define aliases for subcommands.
 * Aliases allow users to invoke the same command by different names.
 *
 * How to run:
 *   pnpx tsx playground/26-command-alias --help
 *   pnpx tsx playground/26-command-alias install lodash
 *   pnpx tsx playground/26-command-alias i lodash
 *   pnpx tsx playground/26-command-alias add lodash
 *   pnpx tsx playground/26-command-alias install --help
 *   pnpx tsx playground/26-command-alias i --help
 *   pnpx tsx playground/26-command-alias remove lodash
 *   pnpx tsx playground/26-command-alias rm lodash
 *   pnpx tsx playground/26-command-alias ls
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// Subcommand: install (aliases: i, add)
export const installCommand = defineCommand({
  name: "install",
  description: "Install packages",
  aliases: ["i", "add"],
  args: z.object({
    packages: arg(z.array(z.string()).default([]), {
      positional: true,
      description: "Packages to install",
    }),
    saveDev: arg(z.boolean().default(false), {
      alias: "D",
      description: "Save as dev dependency",
    }),
    global: arg(z.boolean().default(false), {
      alias: "g",
      description: "Install globally",
    }),
  }),
  run: (args) => {
    if (args.packages.length === 0) {
      console.log("Installing all dependencies...");
    } else {
      const scope = args.global ? "globally" : args.saveDev ? "as devDependency" : "as dependency";
      console.log(`Installing ${scope}:`);
      for (const pkg of args.packages) {
        console.log(`  + ${pkg}`);
      }
    }
  },
});

// Subcommand: remove (aliases: rm, uninstall)
export const removeCommand = defineCommand({
  name: "remove",
  description: "Remove packages",
  aliases: ["rm", "uninstall"],
  args: z.object({
    packages: arg(z.array(z.string()), {
      positional: true,
      description: "Packages to remove",
    }),
  }),
  run: (args) => {
    console.log("Removing:");
    for (const pkg of args.packages) {
      console.log(`  - ${pkg}`);
    }
  },
});

// Subcommand: list (alias: ls)
export const listCommand = defineCommand({
  name: "list",
  description: "List installed packages",
  aliases: ["ls"],
  args: z.object({
    depth: arg(z.coerce.number().default(0), {
      alias: "d",
      description: "Depth of dependency tree",
    }),
  }),
  run: (args) => {
    console.log(`Listing packages (depth: ${args.depth}):`);
    console.log("  my-app@1.0.0");
    console.log("  +-- lodash@4.17.21");
    console.log("  +-- zod@3.24.0");
  },
});

// Main command
export const cli = defineCommand({
  name: "pkg",
  description: "A package manager CLI with command aliases",
  subCommands: {
    install: installCommand,
    remove: removeCommand,
    list: listCommand,
  },
});

if (process.argv[1]?.includes("26-command-alias")) {
  runMain(cli, { version: "1.0.0" });
}
