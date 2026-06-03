/**
 * 02-greet.ts - Greeting command with arguments
 *
 * How to run:
 *   pnpx tsx playground/02-greet.ts World
 *   pnpx tsx playground/02-greet.ts World -g "Hi" -l
 *   pnpx tsx playground/02-greet.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "greet",
  description: "A CLI tool that displays greetings",
  args: z.object({
    name: arg(z.string().meta({}), {
      positional: true,
      description: "Name of the recipient",
    }),
    greeting: arg(z.string().default("Hello"), {
      alias: "g",
      description: "Greeting phrase",
    }),
    loud: arg(z.boolean().default(false), {
      alias: "l",
      description: "Output uppercase",
    }),
  }),
  run: (args) => {
    let message = `${args.greeting}, ${args.name}!`;
    if (args.loud) {
      message = message.toUpperCase();
    }
    console.log(message);
    return message;
  },
});

if (process.argv[1]?.includes("02-greet")) {
  runMain(command, { version: "1.0.0" });
}
