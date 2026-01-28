/**
 * 10-subcommands.ts - Subcommands example
 *
 * How to run:
 *   pnpx tsx playground/10-subcommands.ts --help
 *   pnpx tsx playground/10-subcommands.ts init
 *   pnpx tsx playground/10-subcommands.ts init -t react
 *   pnpx tsx playground/10-subcommands.ts build
 *   pnpx tsx playground/10-subcommands.ts build -o out -m
 *   pnpx tsx playground/10-subcommands.ts build --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// Subcommand: init
export const initCommand = defineCommand({
  name: "init",
  description: "Initialize project",
  args: z.object({
    template: arg(z.string().default("default"), {
      alias: "t",
      description: "Template name",
    }),
    force: arg(z.boolean().default(false), {
      alias: "f",
      description: "Overwrite existing files",
    }),
  }),
  run: (args) => {
    console.log("Initializing project:");
    console.log(`  Template: ${args.template}`);
    if (args.force) {
      console.log("  (force mode)");
    }
  },
});

// Subcommand: build
export const buildCommand = defineCommand({
  name: "build",
  description: "Build project",
  args: z.object({
    output: arg(z.string().default("dist"), {
      alias: "o",
      description: "Output directory",
    }),
    minify: arg(z.boolean().default(false), {
      alias: "m",
      description: "Minify output",
    }),
    watch: arg(z.boolean().default(false), {
      alias: "w",
      description: "Watch file changes",
    }),
  }),
  run: (args) => {
    console.log("Building project:");
    console.log(`  Output: ${args.output}`);
    console.log(`  Minify: ${args.minify}`);
    if (args.watch) {
      console.log("  (watch mode)");
    }
  },
});

// Main command
export const cli = defineCommand({
  name: "my-cli",
  description: "CLI example with subcommands",
  subCommands: {
    init: initCommand,
    build: buildCommand,
  },
});

if (process.argv[1]?.includes("10-subcommands")) {
  runMain(cli, { version: "1.0.0" });
}
