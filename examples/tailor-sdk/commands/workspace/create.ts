import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Create a new workspace
 */
export const createCommand = defineCommand({
  name: "create",
  description: "Create a new workspace",
  args: z.object({
    name: arg(z.string(), {
      description: "Workspace name (3-30 chars, lowercase, numbers, hyphens)",
      alias: "n",
      placeholder: "name",
    }),
    region: arg(z.string(), {
      description: "Region for the workspace (e.g., us-west, asia-northeast)",
      alias: "r",
      placeholder: "region",
    }),
    deleteProtection: arg(z.boolean().default(false), {
      description: "Enable delete protection",
      alias: "d",
    }),
    organizationId: arg(z.string().optional(), {
      description: "Organization ID (UUID)",
      alias: "o",
      placeholder: "uuid",
    }),
    folderId: arg(z.string().optional(), {
      description: "Folder ID (UUID)",
      alias: "f",
      placeholder: "uuid",
    }),
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "Create a workspace",
      input: "tailor-sdk workspace create -n my-workspace -r us-west",
    },
    {
      description: "Create with delete protection",
      input: "tailor-sdk workspace create -n my-workspace -r us-west -d",
    },
  ],
  run: (args) => {
    console.log("workspace create", args);
  },
});
