/**
 * 25-global-options - Global options example
 *
 * Demonstrates runtime global options that are shared across all subcommands.
 *
 * How to run:
 *   pnpx tsx playground/25-global-options/index.ts --help
 *   pnpx tsx playground/25-global-options/index.ts --verbose build --output dist
 *   pnpx tsx playground/25-global-options/index.ts build --verbose --output dist
 *   pnpx tsx playground/25-global-options/index.ts deploy --env staging
 */

import { z } from "zod";
import { arg, createDefineCommand, defineCommand, runMain } from "../../src/index.js";

// ─── Pattern 1: createDefineCommand factory (recommended) ───

interface GlobalArgsType {
  verbose: boolean;
  config?: string;
}

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

export const defineAppCommand = createDefineCommand<GlobalArgsType>();

// Subcommand: build
export const buildCommand = defineAppCommand({
  name: "build",
  description: "Build the project",
  args: z.object({
    output: arg(z.string().default("dist"), {
      alias: "o",
      description: "Output directory",
    }),
  }),
  run: (args) => {
    if (args.verbose) {
      console.log(`[verbose] Config: ${args.config ?? "(default)"}`);
    }
    console.log(`Building to ${args.output}`);
  },
});

// Subcommand: deploy
export const deployCommand = defineAppCommand({
  name: "deploy",
  description: "Deploy the project",
  args: z.object({
    env: arg(z.string().default("production"), {
      alias: "e",
      description: "Target environment",
    }),
  }),
  run: (args) => {
    if (args.verbose) {
      console.log(`[verbose] Config: ${args.config ?? "(default)"}`);
    }
    console.log(`Deploying to ${args.env}`);
  },
});

// Main command (no global args type needed, uses plain defineCommand)
export const cli = defineCommand({
  name: "my-app",
  description: "Application CLI with global options",
  subCommands: {
    build: buildCommand,
    deploy: deployCommand,
  },
});

if (process.argv[1]?.includes("25-global-options")) {
  runMain(cli, { version: "1.0.0", globalArgs: globalArgsSchema });
}
