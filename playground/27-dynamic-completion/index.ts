/**
 * 27-dynamic-completion.ts - In-process dynamic completion example
 *
 * Demonstrates `completion.custom.resolve` callbacks that compute candidates
 * from other arg values typed so far. Modeled after `tailor-sdk api
 * <endpoint> --field key=value`, where the available `--field` keys depend
 * on the chosen `endpoint` positional.
 *
 * How to run:
 *   # Show help
 *   pnpx tsx playground/27-dynamic-completion/index.ts --help
 *
 *   # Generate completion scripts
 *   pnpx tsx playground/27-dynamic-completion/index.ts completion bash
 *
 *   # Test the dynamic resolver via __complete (simulates what the shell calls)
 *   pnpx tsx playground/27-dynamic-completion/index.ts __complete --shell bash -- "GetApplication" "-f" ""
 *   pnpx tsx playground/27-dynamic-completion/index.ts __complete --shell bash -- "CreateApplication" "-f" "cors=https://a" "-f" ""
 *   pnpx tsx playground/27-dynamic-completion/index.ts __complete --shell bash -- "ListApplications" "--field=appli"
 *
 *   # Inline form
 *   pnpx tsx playground/27-dynamic-completion/index.ts __complete --shell bash -- "GetApplication" "--field="
 */

import { z } from "zod";
import { arg, defineCommand, runMain, withCompletionCommand } from "../../src/index.js";

/**
 * Mock data: which fields each endpoint supports. In the real tailor-sdk
 * use case this is read from the proto descriptor.
 */
const ENDPOINT_FIELDS: Record<string, string[]> = {
  GetApplication: ["workspaceId", "applicationName"],
  ListApplications: ["workspaceId", "first", "after"],
  CreateApplication: ["workspaceId", "applicationName", "cors", "disableIntrospection"],
};

const ENDPOINTS = Object.keys(ENDPOINT_FIELDS).sort();

export const apiCommand = defineCommand({
  name: "api",
  description: "Call a mock API with dynamic --field completion.",
  args: z.object({
    endpoint: arg(z.string(), {
      positional: true,
      description: "API endpoint to call.",
      completion: { custom: { choices: ENDPOINTS } },
    }),
    field: arg(z.array(z.string()).default([]), {
      alias: "f",
      description: "Set a request field as `key=value` (repeatable).",
      completion: {
        custom: {
          resolve: ({ parsedArgs, previousValues, currentWord }) => {
            const endpoint = parsedArgs.endpoint as string | undefined;
            if (!endpoint) return { candidates: [] };

            const all = ENDPOINT_FIELDS[endpoint] ?? [];
            // Strip values from previous `key=value` entries so the same key
            // isn't suggested twice. (Real callers also enforce oneof
            // exclusivity here using proto-derived metadata.)
            const usedKeys = new Set(previousValues.map((v) => v.split("=")[0]));

            // If the user has already typed `key=`, suggest values for that
            // key. We have nothing meaningful to suggest in this mock so
            // we just return an empty list — but the integration shows how
            // a resolver can branch on `currentWord` to dispatch.
            if (currentWord.includes("=")) {
              return { candidates: [] };
            }

            return {
              candidates: all
                .filter((k) => !usedKeys.has(k))
                .map((k) => ({ value: `${k}=`, description: `Set ${k}` })),
            };
          },
        },
      },
    }),
  }),
  run: (args) => {
    const fields = Object.fromEntries(
      args.field.map((kv) => {
        const eq = kv.indexOf("=");
        return eq >= 0 ? [kv.slice(0, eq), kv.slice(eq + 1)] : [kv, ""];
      }),
    );
    console.log(JSON.stringify({ endpoint: args.endpoint, fields }, null, 2));
  },
});

export const cli = withCompletionCommand(
  defineCommand({
    name: "tailor-mock",
    description: "Mock CLI showcasing in-process dynamic completion.",
    subCommands: { api: apiCommand },
  }),
);

if (process.argv[1]?.includes("27-dynamic-completion")) {
  runMain(cli, { version: "1.0.0" });
}
