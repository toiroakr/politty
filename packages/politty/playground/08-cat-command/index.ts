/**
 * 08-cat-command.ts - cat command style example (array positional only)
 *
 * How to run:
 *   pnpx tsx playground/08-cat-command.ts file1.txt
 *   pnpx tsx playground/08-cat-command.ts file1.txt file2.txt file3.txt
 *   pnpx tsx playground/08-cat-command.ts -n a.txt b.txt c.txt
 *   pnpx tsx playground/08-cat-command.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "cat",
  description: "Display file contents (cat command style)",
  args: z.object({
    files: arg(z.array(z.string()), {
      positional: true,
      description: "Files to display",
    }),
    number: arg(z.boolean().default(false), {
      alias: "n",
      description: "Show line numbers",
    }),
    showEnds: arg(z.boolean().default(false), {
      alias: "E",
      description: "Show $ at end of lines",
    }),
  }),
  run: (args) => {
    console.log(`Displaying ${args.files.length} file(s):`);
    for (const file of args.files) {
      console.log(`\n=== ${file} ===`);
      // In practice, read and display file contents here
      console.log(`(contents of ${file})`);
      if (args.number) {
        console.log("  (with line numbers)");
      }
      if (args.showEnds) {
        console.log("  (showing line ends)");
      }
    }
  },
});

if (process.argv[1]?.includes("08-cat-command")) {
  runMain(command);
}
