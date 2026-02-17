/**
 * 24-shell-completion.ts - Shell completion example
 *
 * Demonstrates dynamic shell completion with various completion types.
 *
 * How to run:
 *   # Show help
 *   pnpx tsx playground/24-shell-completion/index.ts --help
 *
 *   # Generate completion scripts
 *   pnpx tsx playground/24-shell-completion/index.ts completion bash
 *   pnpx tsx playground/24-shell-completion/index.ts completion zsh
 *   pnpx tsx playground/24-shell-completion/index.ts completion fish
 *
 *   # Show install instructions
 *   pnpx tsx playground/24-shell-completion/index.ts completion bash -i
 *
 *   # Test __complete command directly (simulates what the shell calls)
 *   pnpx tsx playground/24-shell-completion/index.ts __complete -- ""
 *   pnpx tsx playground/24-shell-completion/index.ts __complete -- "deploy" "--"
 *   pnpx tsx playground/24-shell-completion/index.ts __complete -- "deploy" "--env" ""
 *   pnpx tsx playground/24-shell-completion/index.ts __complete -- "deploy" "--config" ""
 *   pnpx tsx playground/24-shell-completion/index.ts __complete -- "build" "--format" ""
 */

import { z } from "zod";
import { arg, defineCommand, runMain, withCompletionCommand } from "../../src/index.js";

// Subcommand: build
export const buildCommand = defineCommand({
  name: "build",
  description: "Build the project",
  args: z.object({
    // Enum values - auto-detected for completion
    format: arg(z.enum(["json", "yaml", "xml"]), {
      alias: "f",
      description: "Output format",
    }),
    output: arg(z.string().default("dist"), {
      alias: "o",
      description: "Output directory",
      // Directory completion
      completion: { type: "directory" },
    }),
    minify: arg(z.boolean().default(false), {
      alias: "m",
      description: "Minify output",
    }),
  }),
  run: (args) => {
    console.log(
      `Building (format: ${args.format}, output: ${args.output}, minify: ${args.minify})`,
    );
  },
});

// Subcommand: deploy
export const deployCommand = defineCommand({
  name: "deploy",
  description: "Deploy the application",
  args: z.object({
    // Custom choices for completion
    env: arg(z.string(), {
      alias: "e",
      description: "Target environment",
      completion: {
        custom: { choices: ["development", "staging", "production"] },
      },
    }),
    // File completion
    config: arg(z.string().optional(), {
      alias: "c",
      description: "Config file path",
      completion: { type: "file", extensions: ["json", "yaml", "yml"] },
    }),
    dryRun: arg(z.boolean().default(false), {
      alias: "n",
      description: "Dry run mode",
    }),
  }),
  run: (args) => {
    const mode = args.dryRun ? " (dry run)" : "";
    console.log(`Deploying to ${args.env}${mode}`);
    if (args.config) {
      console.log(`  Config: ${args.config}`);
    }
  },
});

// Subcommand: test
export const testCommand = defineCommand({
  name: "test",
  description: "Run tests",
  args: z.object({
    // Positional with enum completion
    suite: arg(z.enum(["unit", "integration", "e2e"]).optional(), {
      positional: true,
      description: "Test suite to run",
    }),
    watch: arg(z.boolean().default(false), {
      alias: "w",
      description: "Watch mode",
    }),
  }),
  run: (args) => {
    const suite = args.suite ?? "all";
    console.log(`Running ${suite} tests${args.watch ? " (watch mode)" : ""}`);
  },
});

// Main CLI with completion support
export const cli = withCompletionCommand(
  defineCommand({
    name: "myapp",
    description: "Example CLI with shell completion",
    args: z.object({
      verbose: arg(z.boolean().default(false), {
        alias: "v",
        description: "Verbose output",
      }),
    }),
    subCommands: {
      build: buildCommand,
      deploy: deployCommand,
      test: testCommand,
    },
  }),
);

if (process.argv[1]?.includes("24-shell-completion")) {
  runMain(cli, { version: "1.0.0" });
}
