import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Truncate TailorDB tables
 */
export const truncateCommand = defineCommand({
  name: "truncate",
  description: "Delete records from TailorDB tables",
  args: z.object({
    all: arg(z.boolean().default(false), {
      description: "Truncate all tables",
    }),
    namespace: arg(z.string().optional(), {
      description: "Truncate tables in specific namespace",
      placeholder: "namespace",
    }),
    typeName: arg(z.string().optional(), {
      description: "Truncate specific type",
      placeholder: "type",
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
    yes: arg(z.boolean().default(false), {
      description: "Skip confirmation prompts",
      alias: "y",
    }),
  }),
  notes: `You must specify one of:
  --all         Truncate all tables
  --namespace   Truncate tables in a specific namespace
  --type-name   Truncate a specific type`,
  examples: [
    {
      description: "Truncate all tables",
      input: "tailor-sdk tailordb truncate --all",
    },
    {
      description: "Truncate a specific namespace",
      input: "tailor-sdk tailordb truncate --namespace users",
    },
    {
      description: "Truncate a specific type",
      input: "tailor-sdk tailordb truncate --type-name User",
    },
  ],
  run: (args) => {
    console.log("tailordb truncate", args);
  },
});
