import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Create a personal access token
 */
export const createCommand = defineCommand({
  name: "create",
  description: "Create a new personal access token",
  args: z.object({
    name: arg(z.string(), {
      description: "Token name",
      positional: true,
      placeholder: "name",
    }),
    write: arg(z.boolean().default(false), {
      description: "Grant write permissions to the token",
      alias: "W",
    }),
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "Create a read-only token",
      input: "tailor-sdk user pat create my-token",
    },
    {
      description: "Create a token with write access",
      input: "tailor-sdk user pat create my-token --write",
    },
  ],
  run: (args) => {
    console.log("user pat create", args);
  },
});
