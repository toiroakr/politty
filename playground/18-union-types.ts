import { z } from "zod";
import { defineCommand, runMain } from "../src/index.js";

const args = z.union([
  z
    .object({
      token: z.string().describe("API Token"),
    })
    .describe("Token Auth"),
  z
    .object({
      username: z.string().describe("Username"),
      password: z.string().describe("Password"),
    })
    .describe("Credentials Auth"),
]);

export const main = defineCommand({
  name: "auth-demo",
  description: "Demo of union help with auth methods",
  args,
  run(args) {
    console.log(args);
  },
});

if (process.argv[1]?.includes("18-union-types")) {
  runMain(main);
}
