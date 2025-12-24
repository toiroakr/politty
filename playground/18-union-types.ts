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

const main = defineCommand({
  name: "auth-demo",
  description: "Demo of union help with auth methods",
  args,
  run(context) {
    console.log(context.args);
  },
});

runMain(main);
