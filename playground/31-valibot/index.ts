/**
 * 31-valibot.ts - Building the same CLI with valibot instead of Zod
 *
 * Uses `@politty/valibot`, which exposes the identical politty API backed by
 * valibot schemas. Note the two valibot-specific idioms:
 *   - coercion is a pipe (`v.pipe(v.unknown(), v.transform(Number), ...)`)
 *     where the Zod examples use `z.coerce.number()`
 *   - descriptions can come from `v.description()` as well as `arg()`
 *
 * How to run:
 *   pnpx tsx playground/31-valibot/index.ts config.json -p 8080
 *   pnpx tsx playground/31-valibot/index.ts config.json --level debug --no-color
 *   pnpx tsx playground/31-valibot/index.ts --help
 */

import * as v from "valibot";
import { arg, defineCommand, runMain } from "../../packages/valibot/src/index.js";

export const command = defineCommand({
  name: "serve",
  description: "Serve a project (valibot edition)",
  args: v.object({
    config: arg(v.pipe(v.string(), v.description("Path to the config file")), {
      positional: true,
    }),
    port: arg(
      v.pipe(
        v.unknown(),
        v.transform(Number),
        v.number(),
        v.integer(),
        v.minValue(1),
        v.maxValue(65535),
      ),
      { alias: "p", description: "Port number (1-65535)" },
    ),
    level: arg(v.optional(v.picklist(["debug", "info", "warn"]), "info"), {
      alias: "L",
      description: "Log level",
    }),
    color: arg(v.optional(v.boolean(), true), {
      description: "Colorize output",
      negation: true,
    }),
  }),
  run: (args) => {
    const label = args.color ? `[${args.level}]` : args.level;
    console.log(`${label} serving ${args.config} on port ${args.port}`);
  },
});

if (process.argv[1]?.includes("31-valibot")) {
  runMain(command, { version: "1.0.0" });
}
