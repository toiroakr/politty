import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Deploy application configuration to a workspace
 */
export const applyCommand = defineCommand({
  name: "apply",
  description: "Deploy your application configuration to a workspace",
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
    dryRun: arg(z.boolean().default(false), {
      description: "Show deployment plan without making changes",
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
  notes: `The apply command performs an 8-stage deployment:
1. Load and validate configuration
2. Generate types and build workflows
3. Plan changes for all services
4. Check for conflicts and unmanaged resources
5. Update TailorDB, IdP, Auth, Pipeline, Executor, Workflow
6. Update Application metadata
7. Manage dependent services
8. Cleanup`,
  examples: [
    {
      description: "Deploy to default workspace",
      input: "tailor-sdk apply",
    },
    {
      description: "Deploy with dry-run",
      input: "tailor-sdk apply --dry-run",
    },
    {
      description: "Deploy to specific workspace",
      input: "tailor-sdk apply -w ws-123",
    },
  ],
  run: (args) => {
    console.log("apply", args);
  },
});
