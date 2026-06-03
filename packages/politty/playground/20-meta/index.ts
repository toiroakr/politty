/**
 * Reproduction script for Zod GlobalMeta support
 *
 * Usage:
 *   pnpx tsx playground/repro-meta.ts World
 *   pnpx tsx playground/repro-meta.ts --help
 */

import { z } from "zod";
import "../../src/augment.js"; // Import augmentation
import { defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "greet-meta",
  description: "Test for Zod .meta() support",
  args: z.object({
    name: z.string().meta({
      positional: true,
      description: "Name to greet (via meta)",
    }),
    greeting: z.string().default("Hello").meta({
      alias: "g",
      description: "Greeting phrase (via meta)",
    }),
  }),
  run: (args) => {
    console.log(`${args.greeting}, ${args.name}!`);
  },
});

if (process.argv[1]?.includes("20-meta")) {
  const s = z.string().meta({ description: "test" });
  console.log("Schema def keys:", Object.keys((s as any)._def));
  // console.log("Schema def:", (s as any)._def);
  if ("meta" in (s as any)._def) {
    console.log("Meta in _def:", (s as any)._def.meta);
  } else {
    console.log("Meta NOT in _def");
  }

  console.log("Schema keys:", Object.keys(s));
  if (typeof (s as any).meta === "function") {
    console.log("s.meta() returns:", (s as any).meta());
    console.log("s.meta source:", (s as any).meta.toString());
  } else {
    console.log("s.meta does NOT exist (runtime error should have happened??)");
  }

  runMain(command, { version: "1.0.0" });
}
