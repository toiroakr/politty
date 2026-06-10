/**
 * 13-intersection.ts - intersection example (reusing common options)
 *
 * How to run:
 *   pnpx tsx playground/13-intersection.ts input.txt -o output.txt
 *   pnpx tsx playground/13-intersection.ts data.json -o result.json -v
 *   pnpx tsx playground/13-intersection.ts data.json -o result.json --verbose --config config.json
 *   pnpx tsx playground/13-intersection.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// Common options (reusable across multiple commands)
const baseOptions = z.object({
  verbose: arg(z.boolean().default(false), {
    alias: "v",
    description: "Verbose output",
  }),
  config: arg(z.string().optional(), {
    alias: "c",
    description: "Config file",
  }),
  quiet: arg(z.boolean().default(false), {
    alias: "q",
    description: "Suppress output",
  }),
});

// Process command specific options
const processOptions = z.object({
  input: arg(z.string(), {
    positional: true,
    description: "Input file",
  }),
  output: arg(z.string(), {
    alias: "o",
    description: "Output file",
  }),
});

// Combined with intersection
export const command = defineCommand({
  name: "process",
  description: "Process files (intersection example)",
  args: baseOptions.and(processOptions),
  run: (args) => {
    if (!args.quiet) {
      console.log("Processing file:");
      console.log(`  Input: ${args.input}`);
      console.log(`  Output: ${args.output}`);

      if (args.config) {
        console.log(`  Config: ${args.config}`);
      }

      if (args.verbose) {
        console.log("  (verbose mode enabled)");
        console.log("  Step 1: Reading input file...");
        console.log("  Step 2: Processing data...");
        console.log("  Step 3: Writing output file...");
      }
    }

    console.log("Done!");
  },
});

if (process.argv[1]?.includes("13-intersection")) {
  runMain(command);
}
