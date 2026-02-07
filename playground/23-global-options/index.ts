/**
 * 23-global-options - Global options example
 *
 * Demonstrates how to define global options that are available to all subcommands.
 *
 * How to run:
 *   pnpx tsx playground/23-global-options/index.ts --help
 *   pnpx tsx playground/23-global-options/index.ts --verbose build --output out
 *   pnpx tsx playground/23-global-options/index.ts -v build -o out
 *   pnpx tsx playground/23-global-options/index.ts build --help
 *   pnpx tsx playground/23-global-options/index.ts --config ./config.json deploy --target prod
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// Define global options schema
// These options are available to all commands and subcommands
export const globalArgsSchema = z.object({
  verbose: arg(z.boolean().default(false), {
    alias: "v",
    description: "Enable verbose output",
  }),
  config: arg(z.string().optional(), {
    alias: "c",
    description: "Path to configuration file",
  }),
});

// For type safety with declaration merging, users can extend GlobalArgs:
// declare module "politty" {
//   interface GlobalArgs extends z.infer<typeof globalArgsSchema> {}
// }

// Subcommand: build
export const buildCommand = defineCommand({
  name: "build",
  description: "Build the project",
  args: z.object({
    output: arg(z.string().default("dist"), {
      alias: "o",
      description: "Output directory",
    }),
    minify: arg(z.boolean().default(false), {
      alias: "m",
      description: "Minify output files",
    }),
  }),
  run: (args) => {
    // args includes both command-specific and global options
    // TypeScript knows about global options via declaration merging
    console.log("Building project:");
    console.log(`  Output: ${args.output}`);
    console.log(`  Minify: ${args.minify}`);

    // Access global options
    if ((args as { verbose?: boolean }).verbose) {
      console.log("  [verbose] Verbose mode enabled");
    }
    if ((args as { config?: string }).config) {
      console.log(`  [verbose] Using config: ${(args as { config?: string }).config}`);
    }
  },
});

// Subcommand: deploy
export const deployCommand = defineCommand({
  name: "deploy",
  description: "Deploy the project",
  args: z.object({
    target: arg(z.string(), {
      alias: "t",
      description: "Deployment target (e.g., prod, staging)",
    }),
    dryRun: arg(z.boolean().default(false), {
      alias: "n",
      description: "Perform a dry run without actual deployment",
    }),
  }),
  run: (args) => {
    console.log("Deploying project:");
    console.log(`  Target: ${args.target}`);
    console.log(`  Dry run: ${args.dryRun}`);

    // Access global options
    if ((args as { verbose?: boolean }).verbose) {
      console.log("  [verbose] Verbose mode enabled");
    }
    if ((args as { config?: string }).config) {
      console.log(`  [verbose] Using config: ${(args as { config?: string }).config}`);
    }
  },
});

// Main command with subcommands
export const cli = defineCommand({
  name: "my-cli",
  description: "CLI with global options example",
  subCommands: {
    build: buildCommand,
    deploy: deployCommand,
  },
});

if (process.argv[1]?.includes("23-global-options")) {
  runMain(cli, {
    version: "1.0.0",
    globalArgs: globalArgsSchema,
  });
}
