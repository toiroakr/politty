/**
 * 27-custom-negation.ts - Custom negation option name
 *
 * Demonstrates how to control the boolean negation form. `negation` accepts:
 *
 * - `string` — replace the default `--no-<name>` with a custom name.
 *   The default `--no-<cliName>` (and camelCase `--no<Name>`) forms are
 *   suppressed; only the custom name is recognized.
 * - `true`   — enable the default `--no-<cliName>` form **and** advertise it
 *   in help, generated docs, and shell completions.
 * - `false`  — disable negation entirely. Neither `--no-<cliName>` nor any
 *   custom name is accepted, so the boolean can only be flipped on.
 * - (unset)  — disable negation entirely. No negation form is accepted or
 *   shown (the current default).
 *
 * Optionally, `negationDescription` can be provided alongside a string
 * `negation` or `negation: true` to render the negation option on its own
 * line in help and as a separate row in generated docs. `negationDescription`
 * is not allowed when `negation: false`.
 *
 * How to run:
 *   pnpx tsx playground/27-custom-negation --help
 *   pnpx tsx playground/27-custom-negation                        # defaults
 *   pnpx tsx playground/27-custom-negation --disable-cache        # cache=false
 *   pnpx tsx playground/27-custom-negation --disableCache         # same (camelCase variant)
 *   pnpx tsx playground/27-custom-negation --monochrome           # color=false
 *   pnpx tsx playground/27-custom-negation --pretty               # pretty=true
 *   pnpx tsx playground/27-custom-negation --no-pretty            # pretty=false (advertised)
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
    // Opt in to accepting and advertising the default `--no-pretty`.
    pretty: arg(z.boolean().default(true), {
      description: "Format output for humans",
      negation: true,
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
    console.log(`pretty: ${args.pretty}`);
    console.log(`verbose: ${args.verbose}`);
  },
});

if (process.argv[1]?.includes("27-custom-negation")) {
  runMain(cli, { version: "1.0.0" });
}
