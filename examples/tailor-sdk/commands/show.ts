import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Show deployment information
 */
export const showCommand = defineCommand({
  name: "show",
  description: "Display deployment information",
  args: z.object({
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
    config: arg(z.string().default("tailor.config.ts"), {
      description: "Path to SDK configuration file",
      alias: "c",
      placeholder: "path",
    }),
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "Show deployment info",
      input: "tailor-sdk show",
    },
    {
      description: "Show in JSON format",
      input: "tailor-sdk show --json",
    },
  ],
  run: (args) => {
    console.log("show", args);
  },
});
