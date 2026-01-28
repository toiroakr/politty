/**
 * 07-gcc-command.ts - gcc command style example (array positional arguments)
 *
 * How to run:
 *   pnpx tsx playground/07-gcc-command.ts -o app main.c
 *   pnpx tsx playground/07-gcc-command.ts -o myprogram main.c util.c lib.c
 *   pnpx tsx playground/07-gcc-command.ts --output build/app src/a.c src/b.c src/c.c
 *   pnpx tsx playground/07-gcc-command.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "gcc",
  description: "C compiler (gcc command style)",
  args: z.object({
    output: arg(z.string(), {
      alias: "o",
      description: "Output filename",
    }),
    optimize: arg(z.boolean().default(false), {
      alias: "O",
      description: "Enable optimization",
    }),
    sources: arg(z.array(z.string()), {
      positional: true,
      description: "Source files",
    }),
  }),
  run: (args) => {
    console.log("Compiling:");
    console.log(`  Sources: ${args.sources.join(", ")}`);
    console.log(`  Output: ${args.output}`);
    if (args.optimize) {
      console.log("  Optimization: enabled");
    }
  },
});

if (process.argv[1]?.includes("07-gcc-command")) {
  runMain(command);
}
