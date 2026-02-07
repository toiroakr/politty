/**
 * 05-lifecycle-hooks.ts - Lifecycle hooks example
 *
 * How to run:
 *   pnpx tsx playground/05-lifecycle-hooks.ts --database "postgres://localhost/mydb" --query "SELECT * FROM users"
 *   pnpx tsx playground/05-lifecycle-hooks.ts -d "mysql://localhost/test" -q "SELECT 1"
 *   pnpx tsx playground/05-lifecycle-hooks.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "db-query",
  description: "Execute database query (lifecycle hooks demo)",
  notes: `## Execution Order

1. \`setup\` — Initialize resources (e.g. DB connection)
2. \`run\` — Execute the main logic
3. \`cleanup\` — Release resources (always runs, even on error)

> [!WARNING]
> When \`--simulate-error\` is set, an error is thrown during \`run\`.
> The \`cleanup\` hook is still called to release resources.`,
  args: z.object({
    database: arg(z.string(), {
      alias: "d",
      description: "Database connection string",
    }),
    query: arg(z.string(), {
      alias: "q",
      description: "SQL query",
    }),
    simulate_error: arg(z.boolean().default(false), {
      alias: "e",
      description: "Simulate an error",
    }),
  }),
  setup: async ({ args }) => {
    console.log("[setup] Connecting to database...");
    console.log(`[setup] Connection string: ${args.database}`);
    // In practice, establish DB connection here
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("[setup] Connected!");
  },
  run: async (args) => {
    console.log("[run] Executing query...");
    console.log(`[run] Query: ${args.query}`);

    if (args.simulate_error) {
      throw new Error("Simulated database error!");
    }

    // In practice, execute query here
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("[run] Query completed!");
    return { rowCount: 42, success: true };
  },
  cleanup: async ({ error }) => {
    console.log("[cleanup] Closing database connection...");
    if (error) {
      console.error(`[cleanup] Error occurred: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.log("[cleanup] Connection closed.");
  },
});

if (process.argv[1]?.includes("05-lifecycle-hooks")) {
  runMain(command);
}
