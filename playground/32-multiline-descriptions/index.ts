/**
 * 32-multiline-descriptions.ts - Line breaks in descriptions
 *
 * Descriptions may contain `\n` line breaks. They render as real line breaks
 * everywhere a description appears:
 *   - Terminal help: continuation lines are aligned under the description column.
 *   - Generated Markdown (tables and lists): line breaks become `<br>` so they
 *     stay inside a single table cell / list item.
 *
 * How to run:
 *   pnpx tsx playground/32-multiline-descriptions/index.ts staging
 *   pnpx tsx playground/32-multiline-descriptions/index.ts production -s recreate
 *   pnpx tsx playground/32-multiline-descriptions/index.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../packages/zod/src/index.js";

export const command = defineCommand({
  name: "deploy",
  description: "Deploy the application to a target environment",
  args: z.object({
    target: arg(z.enum(["staging", "production"]), {
      positional: true,
      description:
        "Deployment target environment.\n" +
        "- staging: safe sandbox for verification\n" +
        "- production: live, user-facing environment",
    }),
    strategy: arg(z.enum(["rolling", "recreate"]).default("rolling"), {
      alias: "s",
      description:
        "Rollout strategy.\n" +
        "rolling: replace instances gradually with zero downtime.\n" +
        "recreate: stop all instances, then start the new ones.",
    }),
    yes: arg(z.boolean().default(false), {
      alias: "y",
      description: "Skip the confirmation prompt.\nUse this in CI environments.",
    }),
  }),
  run: (args) => {
    const message = `Deploying to ${args.target} using the ${args.strategy} strategy`;
    console.log(message);
    return { target: args.target, strategy: args.strategy, yes: args.yes };
  },
});

if (process.argv[1]?.includes("32-multiline-descriptions")) {
  runMain(command, { version: "1.0.0" });
}
