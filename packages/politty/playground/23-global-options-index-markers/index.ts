/**
 * 23-global-options-index-markers.ts - Documentation markers for global options tables and command indexes
 *
 * Demonstrates using globalOptions markers and index markers to generate
 * standalone option reference tables and categorized command indexes
 * in documentation files.
 *
 * Usage:
 *   pnpx tsx playground/23-global-options-index-markers/index.ts init my-project
 *   pnpx tsx playground/23-global-options-index-markers/index.ts build --env production
 *   pnpx tsx playground/23-global-options-index-markers/index.ts deploy --env staging --force
 *   pnpx tsx playground/23-global-options-index-markers/index.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// Shared options used across multiple commands (rendered via globalOptions marker)
export const commonOptions = {
  verbose: arg(z.boolean().default(false), {
    alias: "v",
    description: "Enable verbose output",
  }),
  env: arg(z.enum(["development", "staging", "production"]).default("development"), {
    alias: "e",
    description: "Target environment",
  }),
};

// init subcommand
export const initCommand = defineCommand({
  name: "init",
  description: "Initialize a new project",
  args: z.object({
    name: arg(z.string(), {
      positional: true,
      description: "Project name",
    }),
    template: arg(z.string().default("default"), {
      alias: "t",
      description: "Project template to use",
    }),
  }),
  run: (args) => {
    console.log(`Initialized project "${args.name}" with template "${args.template}"`);
  },
});

// build subcommand
export const buildCommand = defineCommand({
  name: "build",
  description: "Build the project",
  args: z.object({
    ...commonOptions,
    watch: arg(z.boolean().default(false), {
      alias: "w",
      description: "Watch for changes",
    }),
  }),
  run: (args) => {
    const mode = args.watch ? "watch" : "single";
    console.log(`Building in ${args.env} mode (${mode})`);
  },
});

// deploy subcommand
export const deployCommand = defineCommand({
  name: "deploy",
  description: "Deploy the project",
  args: z.object({
    ...commonOptions,
    force: arg(z.boolean().default(false), {
      alias: "f",
      description: "Force deployment without confirmation",
    }),
  }),
  run: (args) => {
    const force = args.force ? " (forced)" : "";
    console.log(`Deploying to ${args.env}${force}`);
  },
});

// main command
export const command = defineCommand({
  name: "project-cli",
  description: "Project management CLI demonstrating docs markers",
  subCommands: {
    init: initCommand,
    build: buildCommand,
    deploy: deployCommand,
  },
});

if (process.argv[1]?.includes("23-global-options-index-markers")) {
  runMain(command, { version: "1.0.0" });
}
