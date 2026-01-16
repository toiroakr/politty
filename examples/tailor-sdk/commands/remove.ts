import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Remove application-related resources
 */
export const removeCommand = defineCommand({
  name: "remove",
  description: "Remove application-related resources from a workspace",
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
    yes: arg(z.boolean().default(false), {
      description: "Skip confirmation prompts",
      alias: "y",
    }),
    verbose: arg(z.boolean().default(false), {
      description: "Enable verbose output",
    }),
    envFile: arg(z.string().optional(), {
      description: "Path to environment file",
      alias: "e",
      placeholder: "path",
    }),
  }),
  examples: [
    {
      description: "Remove application resources",
      input: "tailor-sdk remove",
    },
    {
      description: "Remove without confirmation",
      input: "tailor-sdk remove -y",
    },
  ],
  run: (args) => {
    console.log("remove", args);
  },
});
