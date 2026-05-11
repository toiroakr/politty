/**
 * 27-custom-negation.ts - Custom negation option name
 *
 * Demonstrates how to replace the default `--no-<name>` negation form with a
 * custom name for boolean fields. When `negation` is set, the auto-generated
 * `--no-<cliName>` (and camelCase `--no<Name>`) forms are suppressed and only
 * the custom name is recognized.
 *
 * Optionally, `negationDescription` can be provided to render the negation
 * option on its own line in help and as a separate row in generated docs.
 *
 * How to run:
 *   pnpx tsx playground/27-custom-negation --help
 *   pnpx tsx playground/27-custom-negation                        # cache=true, color=true
 *   pnpx tsx playground/27-custom-negation --disable-cache        # cache=false
 *   pnpx tsx playground/27-custom-negation --disableCache         # same (camelCase variant)
 *   pnpx tsx playground/27-custom-negation --monochrome           # color=false
 *   pnpx tsx playground/27-custom-negation --no-cache             # WARN: unknown option
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const cli = defineCommand({
  name: "build",
  description: "Build with cache and color toggles using custom negation names",
  args: z.object({
    // Custom negation without a separate description: rendered inline in help
    // as `--cache, --disable-cache`.
    cache: arg(z.boolean().default(true), {
      description: "Use the build cache",
      negation: "disable-cache",
    }),
    // Custom negation with its own description: rendered as a separate help
    // line and as a separate row in the docs table.
    color: arg(z.boolean().default(true), {
      description: "Colorize output",
      negation: "monochrome",
      negationDescription: "Disable colorized output",
    }),
  }),
  run: (args) => {
    console.log(`cache: ${args.cache}`);
    console.log(`color: ${args.color}`);
  },
});

if (process.argv[1]?.includes("27-custom-negation")) {
  runMain(cli, { version: "1.0.0" });
}
