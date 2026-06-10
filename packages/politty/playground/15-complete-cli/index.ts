/**
 * 15-complete-cli.ts - Complete CLI example
 *
 * How to run:
 *   pnpx tsx playground/15-complete-cli.ts --help
 *   pnpx tsx playground/15-complete-cli.ts --version
 *   pnpx tsx playground/15-complete-cli.ts file.txt -o out.txt
 *   pnpx tsx playground/15-complete-cli.ts file.txt -o out.txt -v
 *   pnpx tsx playground/15-complete-cli.ts init
 *   pnpx tsx playground/15-complete-cli.ts init -t react
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// init subcommand
export const initCommand = defineCommand({
  name: "init",
  description: "Initialize a new project",
  args: z.object({
    template: arg(z.string().default("default"), {
      alias: "t",
      description: "Template to use",
    }),
    name: arg(z.string().optional(), {
      alias: "n",
      description: "Project name",
    }),
  }),
  run: (args) => {
    const projectName = args.name ?? "my-project";
    console.log(`Initializing project "${projectName}" with template "${args.template}"...`);
    console.log("Done!");
  },
});

// Main CLI
export const cli = defineCommand({
  name: "my-tool",
  description: "Complete CLI tool example",
  notes: "Supports subcommands, lifecycle hooks, and multiple output formats.",
  args: z.object({
    input: arg(z.string(), {
      positional: true,
      description: "Input file",
    }),
    output: arg(z.string(), {
      alias: "o",
      description: "Output file",
    }),
    verbose: arg(z.boolean().default(false), {
      alias: "v",
      description: "Enable verbose output",
    }),
    format: arg(z.enum(["json", "yaml", "toml"]).default("json"), {
      alias: "f",
      description: "Output format",
    }),
  }),
  subCommands: {
    init: initCommand,
  },
  setup: async ({ args }) => {
    if (args.verbose) {
      console.log("[setup] Initializing...");
    }
  },
  run: async (args) => {
    if (args.verbose) {
      console.log("[run] Processing...");
    }

    console.log("Processing:");
    console.log(`  Input: ${args.input}`);
    console.log(`  Output: ${args.output}`);
    console.log(`  Format: ${args.format}`);

    // Simulate processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    return { processed: true, format: args.format };
  },
  cleanup: async ({ args, error }) => {
    if (args.verbose) {
      console.log("[cleanup] Cleaning up...");
    }
    if (error) {
      console.error(`[cleanup] Error: ${error.message}`);
    }
  },
});

if (process.argv[1]?.includes("15-complete-cli")) {
  runMain(cli, { version: "2.0.0" });
}
