/**
 * 27-custom-negation.ts - Custom negation option name
 *
 * Demonstrates how to customize the boolean negation form. `negation` accepts
 * two shapes:
 *
 * - `string` — replace the default `--no-<name>` with a custom name.
 *   The default `--no-<cliName>` (and camelCase `--no<Name>`) forms are
 *   suppressed; only the custom name is recognized.
 * - `false`  — disable negation entirely. Neither `--no-<cliName>` nor any
 *   custom name is accepted, so the boolean can only be flipped on.
 *
 * Optionally, `negationDescription` can be provided alongside a string
 * `negation` to render the negation option on its own line in help and as a
 * separate row in generated docs. `negationDescription` is not allowed when
 * `negation: false`.
 *
 * How to run:
 *   pnpx tsx playground/27-custom-negation --help
 *   pnpx tsx playground/27-custom-negation                        # cache=true, color=true, verbose=false
 *   pnpx tsx playground/27-custom-negation --disable-cache        # cache=false
 *   pnpx tsx playground/27-custom-negation --disableCache         # same (camelCase variant)
 *   pnpx tsx playground/27-custom-negation --monochrome           # color=false
 *   pnpx tsx playground/27-custom-negation --verbose              # verbose=true
 *   pnpx tsx playground/27-custom-negation --no-cache             # WARN: unknown option
 *   pnpx tsx playground/27-custom-negation --no-verbose           # WARN: unknown option
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const cli = defineCommand({
  name: "build",
  description: "Build with cache and color toggles using custom negation names",
  args: z.object({
    // Custom negation without a separate description: rendered inline in help
    // as `--cache / --disable-cache`.
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
    // Negation disabled: only `--verbose` is accepted; `--no-verbose` is
    // treated as an unknown option.
    verbose: arg(z.boolean().default(false), {
      description: "Enable verbose logging (no negation flag)",
      negation: false,
    }),
  }),
  run: (args) => {
    console.log(`cache: ${args.cache}`);
    console.log(`color: ${args.color}`);
    console.log(`verbose: ${args.verbose}`);
  },
});

if (process.argv[1]?.includes("27-custom-negation")) {
  runMain(cli, { version: "1.0.0" });
}
