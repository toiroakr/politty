/**
 * 21-lazy-subcommands.ts - Lazy loading subcommands example
 *
 * This example demonstrates true lazy loading using dynamic imports.
 * Subcommands are only loaded when they are actually invoked.
 *
 * Usage:
 *   pnpx tsx playground/21-lazy-subcommands.ts --help
 *   pnpx tsx playground/21-lazy-subcommands.ts status
 *   pnpx tsx playground/21-lazy-subcommands.ts heavy
 *   pnpx tsx playground/21-lazy-subcommands.ts heavy -n 5000 -v
 *   pnpx tsx playground/21-lazy-subcommands.ts analytics
 *   pnpx tsx playground/21-lazy-subcommands.ts analytics -m complexity -f json
 *
 * Notice:
 *   - When running --help or status, you won't see "[heavy-command] Module loaded"
 *   - When running "heavy" command, you will see the module load message
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../src/index.js";

// Eager loaded command (always loaded)
export const statusCommand = defineCommand({
  name: "status",
  description: "Show current status (eagerly loaded)",
  args: z.object({
    verbose: arg(z.boolean().default(false), {
      alias: "v",
      description: "Show detailed status",
    }),
  }),
  run: ({ verbose }) => {
    console.log("Status: OK");
    if (verbose) {
      console.log("  Uptime: 42 days");
      console.log("  Memory: 128MB");
    }
  },
});

// Main CLI with mixed eager and lazy subcommands
export const cli = defineCommand({
  name: "my-app",
  description: "CLI demonstrating lazy loading subcommands with dynamic imports",
  subCommands: {
    // Eagerly loaded - always available immediately
    status: statusCommand,

    // Lazily loaded - only loaded when invoked
    heavy: async () => {
      const { heavyCommand } = await import("./commands/heavy-command.js");
      return heavyCommand;
    },

    // Another lazy command
    analytics: async () => {
      const { analyticsCommand } = await import("./commands/analytics-command.js");
      return analyticsCommand;
    },
  },
});

if (process.argv[1]?.includes("21-lazy-subcommands")) {
  runMain(cli, { version: "1.0.0" });
}
