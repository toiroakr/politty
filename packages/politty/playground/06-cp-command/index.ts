/**
 * 06-cp-command.ts - cp command style example (multiple positional arguments)
 *
 * How to run:
 *   pnpx tsx playground/06-cp-command.ts source.txt dest.txt
 *   pnpx tsx playground/06-cp-command.ts /path/from /path/to -r
 *   pnpx tsx playground/06-cp-command.ts file1.txt file2.txt --recursive
 *   pnpx tsx playground/06-cp-command.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "cp",
  description: "Copy files (cp command style)",
  args: z.object({
    source: arg(z.string(), {
      positional: true,
      description: "Source file",
    }),
    destination: arg(z.string(), {
      positional: true,
      description: "Destination file",
    }),
    recursive: arg(z.boolean().default(false), {
      alias: "r",
      description: "Copy directories recursively",
    }),
    force: arg(z.boolean().default(false), {
      alias: "f",
      description: "Skip overwrite confirmation",
    }),
  }),
  run: (args) => {
    console.log(`Copying: ${args.source} -> ${args.destination}`);
    if (args.recursive) {
      console.log("  (recursive mode)");
    }
    if (args.force) {
      console.log("  (force mode)");
    }
  },
});

if (process.argv[1]?.includes("06-cp-command")) {
  runMain(command);
}
