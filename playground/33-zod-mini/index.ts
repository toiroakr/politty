/**
 * 33-zod-mini.ts - Building the same CLI with zod/mini instead of classic Zod
 *
 * Uses `@politty/zod-mini`, which exposes the identical politty API backed by
 * zod/mini schemas. Note the two zod/mini-specific idioms:
 *   - schemas are built with functions instead of chained methods
 *     (`z.optional(z.string())`, `z._default(z.string(), "info")` where the
 *     Zod examples use `.optional()`/`.default("info")`)
 *   - descriptions can come from `.register(z.globalRegistry, {...})` as well
 *     as `arg()`
 *
 * How to run:
 *   pnpx tsx playground/33-zod-mini/index.ts config.json -p 8080
 *   pnpx tsx playground/33-zod-mini/index.ts config.json --level debug --no-color
 *   pnpx tsx playground/33-zod-mini/index.ts --help
 */

import * as z from "zod/mini";
import { arg, defineCommand, runMain } from "../../packages/zod-mini/src/index.js";

export const command = defineCommand({
  name: "serve",
  description: "Serve a project (zod/mini edition)",
  args: z.object({
    config: arg(z.string().register(z.globalRegistry, { description: "Path to the config file" }), {
      positional: true,
    }),
    port: arg(z.coerce.number().check(z.minimum(1), z.maximum(65535), z.multipleOf(1)), {
      alias: "p",
      description: "Port number (1-65535)",
    }),
    level: arg(z._default(z.enum(["debug", "info", "warn"]), "info"), {
      alias: "L",
      description: "Log level",
    }),
    color: arg(z._default(z.boolean(), true), {
      description: "Colorize output",
      negation: true,
    }),
  }),
  run: (args) => {
    const label = args.color ? `[${args.level}]` : args.level;
    console.log(`${label} serving ${args.config} on port ${args.port}`);
  },
});

if (process.argv[1]?.includes("33-zod-mini")) {
  runMain(command, { version: "1.0.0" });
}
