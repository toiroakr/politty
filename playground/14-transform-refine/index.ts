/**
 * 14-transform-refine.ts - transform/refine example
 *
 * How to run:
 *   pnpx tsx playground/14-transform-refine.ts hello --tags "a,b,c"
 *   pnpx tsx playground/14-transform-refine.ts WORLD -t "tag1,tag2"
 *   pnpx tsx playground/14-transform-refine.ts input.txt output.txt   # Same filename causes error
 *   pnpx tsx playground/14-transform-refine.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// transform example
export const transformCommand = defineCommand({
  name: "transform-example",
  description: "Example using transform for conversion",
  args: z.object({
    // Convert to uppercase
    name: arg(
      z.string().transform((s) => s.toUpperCase()),
      {
        positional: true,
        description: "Name (will be converted to uppercase)",
      },
    ),
    // Convert comma-separated to array
    tags: arg(
      z.string().transform((s) => s.split(",").map((t) => t.trim())),
      {
        alias: "t",
        description: "Comma-separated tags",
      },
    ),
  }),
  run: (args) => {
    console.log("Transform example:");
    console.log(`  Name: ${args.name} (uppercased)`);
    console.log(`  Tags: ${JSON.stringify(args.tags)} (split from comma-separated)`);
  },
});

// refine example
export const refineCommand = defineCommand({
  name: "refine-example",
  description: "Example using refine for custom validation",
  args: z
    .object({
      input: arg(z.string(), {
        positional: true,
        description: "Input file",
      }),
      output: arg(z.string(), {
        positional: true,
        description: "Output file",
      }),
    })
    .refine((data) => data.input !== data.output, {
      message: "Input and output must be different files",
    }),
  run: (args) => {
    console.log("Refine example:");
    console.log(`  Input: ${args.input}`);
    console.log(`  Output: ${args.output}`);
    console.log("  (validation passed: input !== output)");
  },
});

// Command selection
export const cli = defineCommand({
  name: "validation-demo",
  description: "Demo of transform/refine",
  subCommands: {
    transform: transformCommand,
    refine: refineCommand,
  },
});

if (process.argv[1]?.includes("14-transform-refine")) {
  runMain(cli, { version: "1.0.0" });
}
