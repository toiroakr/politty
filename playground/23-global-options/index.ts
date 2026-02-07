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

// Type for global args (for use with type parameter pattern)
export type GlobalArgsType = z.infer<typeof globalArgsSchema>;

// ============================================================
// Pattern 1: Type parameter (recommended for explicit typing)
// ============================================================
// Use the third type parameter to specify global args type.
// This provides full type safety without declaration merging.

// Define args schemas separately to use in type parameters
const buildArgsSchema = z.object({
  output: arg(z.string().default("dist"), {
    alias: "o",
    description: "Output directory",
  }),
  minify: arg(z.boolean().default(false), {
    alias: "m",
    description: "Minify output files",
  }),
});

const deployArgsSchema = z.object({
  target: arg(z.string(), {
    alias: "t",
    description: "Deployment target (e.g., prod, staging)",
  }),
  dryRun: arg(z.boolean().default(false), {
    alias: "n",
    description: "Perform a dry run without actual deployment",
  }),
});

// Subcommand: build (using type parameter for global args)
export const buildCommand = defineCommand<
  typeof buildArgsSchema,
  void,
  GlobalArgsType // Third type parameter specifies global args type
>({
  name: "build",
  description: "Build the project",
  args: buildArgsSchema,
  run: (args) => {
    // args includes both command-specific and global options
    // TypeScript knows about verbose and config from GlobalArgsType
    console.log("Building project:");
    console.log(`  Output: ${args.output}`);
    console.log(`  Minify: ${args.minify}`);

    // Access global options (fully typed!)
    if (args.verbose) {
      console.log("  [verbose] Verbose mode enabled");
    }
    if (args.config) {
      console.log(`  [verbose] Using config: ${args.config}`);
    }
  },
});

// Subcommand: deploy (using type parameter for global args)
export const deployCommand = defineCommand<typeof deployArgsSchema, void, GlobalArgsType>({
  name: "deploy",
  description: "Deploy the project",
  args: deployArgsSchema,
  run: (args) => {
    console.log("Deploying project:");
    console.log(`  Target: ${args.target}`);
    console.log(`  Dry run: ${args.dryRun}`);

    // Access global options (fully typed!)
    if (args.verbose) {
      console.log("  [verbose] Verbose mode enabled");
    }
    if (args.config) {
      console.log(`  [verbose] Using config: ${args.config}`);
    }
  },
});

// ============================================================
// Pattern 2: Declaration merging (alternative approach)
// ============================================================
// Uncomment the following to use declaration merging instead:
//
// declare module "politty" {
//   interface GlobalArgs extends z.infer<typeof globalArgsSchema> {}
// }
//
// Then you can define commands without the type parameter:
// const buildCommand = defineCommand({
//   name: "build",
//   args: z.object({ ... }),
//   run: (args) => {
//     // args.verbose is typed automatically via GlobalArgs
//   },
// });

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
