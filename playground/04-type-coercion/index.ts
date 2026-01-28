/**
 * 04-type-coercion.ts - Type coercion and validation example
 *
 * How to run:
 *   pnpx tsx playground/04-type-coercion.ts -p 8080 -n 5
 *   pnpx tsx playground/04-type-coercion.ts --port 3000 --count 10
 *   pnpx tsx playground/04-type-coercion.ts -p 99999    # Validation error
 *   pnpx tsx playground/04-type-coercion.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "server",
  description: "Server configuration example (type coercion and validation)",
  args: z.object({
    port: arg(z.coerce.number().int().min(1).max(65535), {
      alias: "p",
      description: "Port number (1-65535)",
    }),
    count: arg(z.coerce.number().int().positive().default(1), {
      alias: "n",
      description: "Repeat count",
    }),
    host: arg(z.string().default("localhost"), {
      alias: "h",
      description: "Hostname",
      overrideBuiltinAlias: true,
    }),
  }),
  run: (args) => {
    console.log("Server Configuration:");
    console.log(`  Host: ${args.host}`);
    console.log(`  Port: ${args.port} (type: ${typeof args.port})`);
    console.log(`  Count: ${args.count} (type: ${typeof args.count})`);
  },
});

if (process.argv[1]?.includes("04-type-coercion")) {
  runMain(command);
}
