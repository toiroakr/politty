/**
 * 19-xor-types.ts - xor (exclusive union) example
 *
 * Run:
 *   pnpx tsx playground/19-xor-types.ts --help
 *   pnpx tsx playground/19-xor-types.ts --token abc123
 *   pnpx tsx playground/19-xor-types.ts --username admin --password secret
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../src/index.js";

const args = z.xor([
  z
    .object({
      token: arg(z.string(), { description: "API Token" }),
    })
    .describe("Token Auth"),
  z
    .object({
      username: arg(z.string(), { description: "Username" }),
      password: arg(z.string(), { description: "Password" }),
    })
    .describe("Credentials Auth"),
]);

export const main = defineCommand({
  name: "auth-demo",
  description: "Demo of xor (exclusive union) help with auth methods",
  args,
  run(args) {
    if ("token" in args) {
      console.log("Authenticated with token:", args.token);
    } else {
      console.log("Authenticated with credentials:");
      console.log("  Username:", args.username);
      console.log("  Password:", args.password);
    }
  },
});

if (process.argv[1]?.includes("19-xor-types")) {
  runMain(main);
}
