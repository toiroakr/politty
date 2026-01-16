import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Switch to a different user
 */
export const switchCommand = defineCommand({
  name: "switch",
  description: "Switch to a different authenticated user",
  args: z.object({
    user: arg(z.string(), {
      description: "User email to switch to",
      positional: true,
      placeholder: "email",
    }),
  }),
  examples: [
    {
      description: "Switch to a different user",
      input: "tailor-sdk user switch user@example.com",
    },
  ],
  run: (args) => {
    console.log("user switch", args);
  },
});
