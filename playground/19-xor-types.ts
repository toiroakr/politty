/**
 * 19-xor-types.ts - xor (exclusive union) example
 *
 * Run:
 *   pnpx tsx playground/19-xor-types.ts --help
 *   pnpx tsx playground/19-xor-types.ts --token abc123
 *   pnpx tsx playground/19-xor-types.ts --username admin --password secret
 */

import { z } from "zod";
import { defineCommand, runMain, arg } from "../src/index.js";

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

const main = defineCommand({
  name: "auth-demo",
  description: "Demo of xor (exclusive union) help with auth methods",
  args,
  run(context) {
    if ("token" in context.args) {
      console.log("Authenticated with token:", context.args.token);
    } else {
      console.log("Authenticated with credentials:");
      console.log("  Username:", context.args.username);
      console.log("  Password:", context.args.password);
    }
  },
});

runMain(main);
