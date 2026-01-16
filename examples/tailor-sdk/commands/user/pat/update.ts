import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Update a personal access token
 */
export const updateCommand = defineCommand({
  name: "update",
  description: "Update a personal access token",
  args: z.object({
    name: arg(z.string(), {
      description: "Token name to update",
      positional: true,
      placeholder: "name",
    }),
    write: arg(z.boolean().optional(), {
      description: "Update write permission",
      alias: "W",
    }),
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "Update token permissions",
      input: "tailor-sdk user pat update my-token --write",
    },
  ],
  run: (args) => {
    console.log("user pat update", args);
  },
});
