import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Execute API operations
 */
export const apiCommand = defineCommand({
  name: "api",
  description: "Execute API operations against Tailor Platform",
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
    query: arg(z.string().optional(), {
      description: "GraphQL query to execute",
      alias: "q",
      placeholder: "query",
    }),
    variables: arg(z.string().optional(), {
      description: "JSON variables for the query",
      alias: "v",
      placeholder: "json",
    }),
  }),
  examples: [
    {
      description: "Execute a GraphQL query",
      input: 'tailor-sdk api -q "{ users { id name } }"',
    },
  ],
  run: (args) => {
    console.log("api", args);
  },
});
