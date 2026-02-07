/**
 * 12-discriminated-union.ts - discriminatedUnion example (mutually exclusive options)
 *
 * How to run:
 *   pnpx tsx playground/12-discriminated-union.ts --help
 *   pnpx tsx playground/12-discriminated-union.ts --action create --name my-resource
 *   pnpx tsx playground/12-discriminated-union.ts --action create --name my-resource --template basic
 *   pnpx tsx playground/12-discriminated-union.ts --action delete --id 123
 *   pnpx tsx playground/12-discriminated-union.ts --action delete --id 456 -f
 *   pnpx tsx playground/12-discriminated-union.ts --action list
 *   pnpx tsx playground/12-discriminated-union.ts --action list -f json
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "resource",
  description: "Manage resources (discriminatedUnion example)",
  notes: `Available options vary depending on the value of \`--action\`.

- \`create\` — \`--name\`, \`--template\`
- \`delete\` — \`--id\`, \`--force\`
- \`list\` — \`--format\`, \`--limit\`

> **Note:** Only the options for the selected action are accepted.`,
  args: z
    .discriminatedUnion("action", [
      // create action
      z
        .object({
          action: z.literal("create"),
          name: arg(z.string(), { description: "Resource name" }),
          template: arg(z.string().optional(), { description: "Template" }),
        })
        .describe("Create a new resource"),
      // delete action
      z
        .object({
          action: z.literal("delete"),
          id: arg(z.coerce.number(), { description: "Resource ID" }),
          force: arg(z.boolean().default(false), {
            alias: "f",
            description: "Delete without confirmation",
          }),
        })
        .describe("Delete an existing resource"),
      // list action
      z.object({
        action: z.literal("list"),
        format: arg(z.enum(["json", "table"]).default("table"), {
          alias: "F",
          description: "Output format",
        }),
        limit: arg(z.coerce.number().default(10), {
          alias: "n",
          description: "Display limit",
        }),
      }),
    ])
    .describe("Action"),
  run: (args) => {
    switch (args.action) {
      case "create":
        console.log("Creating resource:");
        console.log(`  Name: ${args.name}`);
        if (args.template) {
          console.log(`  Template: ${args.template}`);
        }
        break;

      case "delete":
        console.log("Deleting resource:");
        console.log(`  ID: ${args.id}`);
        if (args.force) {
          console.log("  (force mode - no confirmation)");
        }
        break;

      case "list":
        console.log("Listing resources:");
        console.log(`  Format: ${args.format}`);
        console.log(`  Limit: ${args.limit}`);
        // In practice, list resources here
        console.log("  (simulated resource list)");
        break;
    }
  },
});

if (process.argv[1]?.includes("12-discriminated-union")) {
  runMain(command);
}
