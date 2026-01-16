import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Deploy a static website
 */
export const deployCommand = defineCommand({
  name: "deploy",
  description: "Deploy a static website",
  args: z.object({
    name: arg(z.string(), {
      description: "Website name",
      positional: true,
      placeholder: "name",
    }),
    directory: arg(z.string(), {
      description: "Directory containing static files",
      positional: true,
      placeholder: "dir",
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
  notes: `Deploys all files from the specified directory.
MIME types are automatically detected from file extensions.`,
  examples: [
    {
      description: "Deploy a website",
      input: "tailor-sdk staticwebsite deploy my-site ./dist",
    },
  ],
  run: (args) => {
    console.log("staticwebsite deploy", args);
  },
});
