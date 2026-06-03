/**
 * 09-convert-command.ts - Optional positional arguments example
 *
 * How to run:
 *   pnpx tsx playground/09-convert-command.ts input.json
 *   pnpx tsx playground/09-convert-command.ts input.json output.yaml
 *   pnpx tsx playground/09-convert-command.ts input.json output.yaml -f yaml
 *   pnpx tsx playground/09-convert-command.ts data.json -f toml
 *   pnpx tsx playground/09-convert-command.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "convert",
  description: "Convert file format (optional positional example)",
  args: z.object({
    input: arg(z.string(), {
      positional: true,
      description: "Input file",
    }),
    output: arg(z.string().optional(), {
      positional: true,
      description: "Output file (stdout if omitted)",
    }),
    format: arg(z.enum(["json", "yaml", "toml"]).default("json"), {
      alias: "f",
      description: "Output format",
    }),
  }),
  run: (args) => {
    const destination = args.output ?? "stdout";
    console.log("Converting:");
    console.log(`  Input: ${args.input}`);
    console.log(`  Output: ${destination}`);
    console.log(`  Format: ${args.format}`);
  },
});

if (process.argv[1]?.includes("09-convert-command")) {
  runMain(command);
}
