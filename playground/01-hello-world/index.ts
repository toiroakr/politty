/**
 * 01-hello-world.ts - Minimal command configuration
 *
 * How to run:
 *   pnpx tsx playground/01-hello-world.ts
 *   pnpx tsx playground/01-hello-world.ts --help
 */

import { defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "hello",
  description: "A simple command that displays Hello World",
  run: () => {
    console.log("Hello, World!");
  },
});

if (process.argv[1]?.includes("01-hello-world")) {
  runMain(command, { version: "1.0.0" });
}
