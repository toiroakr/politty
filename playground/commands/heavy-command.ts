/**
 * heavy-command.ts - Lazy loaded command example
 *
 * This command is defined in a separate file to demonstrate
 * true lazy loading with dynamic imports.
 */

import { z } from "zod";
import { arg, defineCommand } from "../../src/index.js";

// Simulate heavy initialization
console.log("[heavy-command] Module loaded");

export const heavyCommand = defineCommand({
  name: "heavy",
  description: "A heavy command that is lazily loaded",
  args: z.object({
    iterations: arg(z.coerce.number().default(1000), {
      alias: "n",
      description: "Number of iterations",
    }),
    verbose: arg(z.boolean().default(false), {
      alias: "v",
      description: "Verbose output",
    }),
  }),
  run: ({ iterations, verbose }) => {
    console.log(`Running heavy computation with ${iterations} iterations...`);
    if (verbose) {
      console.log("  (verbose mode enabled)");
    }
    // Simulate heavy work
    let result = 0;
    for (let i = 0; i < iterations; i++) {
      result += Math.sqrt(i);
    }
    console.log(`  Result: ${result.toFixed(2)}`);
  },
});
