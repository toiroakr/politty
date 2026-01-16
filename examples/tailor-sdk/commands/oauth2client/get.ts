import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Get OAuth2 client details
 */
export const getCommand = defineCommand({
  name: "get",
  description: "Get OAuth2 client details",
  args: z.object({
    name: arg(z.string(), {
      description: "OAuth2 client name",
      positional: true,
      placeholder: "name",
    }),
    workspaceId: arg(z.string().optional(), {
      description: "Target workspace ID",
      alias: "w",
      placeholder: "id",
      env: "TAILOR_WORKSPACE_ID",
    }),
    profile: arg(z.string().optional(), {
      description: "Profile to use",
      alias: "p",
      placeholder: "name",
    }),
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "Get OAuth2 client details",
      input: "tailor-sdk oauth2client get my-client",
    },
  ],
  run: (args) => {
    console.log("oauth2client get", args);
  },
});
