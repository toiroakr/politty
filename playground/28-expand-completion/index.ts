/**
 * 28-expand-completion.ts - Pre-enumerated value completion ("expand")
 *
 * Demonstrates `completion.custom.expand`, which pre-enumerates candidates
 * at script-generation time and bakes them into the static shell script.
 * Unlike `completion.custom.resolve`, no Node process is spawned at TAB
 * time — the shell dispatches via a case lookup keyed on sibling arg
 * values.
 *
 * Mirrors the `tailor-sdk api <endpoint> --field key=value` shape, where
 * the available `--field` keys depend on the chosen `endpoint` positional.
 *
 * How to run:
 *   pnpx tsx playground/28-expand-completion/index.ts --help
 *
 *   # Generate completion scripts
 *   pnpx tsx playground/28-expand-completion/index.ts completion bash
 *   pnpx tsx playground/28-expand-completion/index.ts completion zsh
 *   pnpx tsx playground/28-expand-completion/index.ts completion fish
 */

import { z } from "zod";
import { arg, defineCommand, runMain, withCompletionCommand } from "../../src/index.js";

/**
 * Static metadata: which keys each endpoint supports and which discrete
 * values (if any) each key accepts. In a real CLI this is generated from
 * the proto descriptor at build time.
 */
const ENDPOINT_FIELDS: Record<string, Array<{ key: string; values?: string[] }>> = {
  GetApplication: [{ key: "workspaceId" }, { key: "applicationName" }],
  ListApplications: [
    { key: "workspaceId" },
    { key: "first" },
    { key: "after" },
    { key: "pageDirection", values: ["NEXT", "PREVIOUS"] },
  ],
  CreateApplication: [
    { key: "workspaceId" },
    { key: "applicationName" },
    { key: "cors" },
    { key: "disableIntrospection", values: ["true", "false"] },
  ],
};

const ENDPOINTS = Object.keys(ENDPOINT_FIELDS).sort();

export const apiCommand = defineCommand({
  name: "api",
  description: "Call a mock API. `--field` candidates depend on `<endpoint>`.",
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
          expand: {
            dependsOn: ["endpoint"],
            enumerate: (deps) => {
              const endpoint = deps.endpoint ?? "";
              const fields = ENDPOINT_FIELDS[endpoint] ?? [];
              const out: Array<{ value: string; description?: string }> = [];
              for (const f of fields) {
                // Always emit the bare `key=` entry so the framework can
                // surface keys before the user types `=`. When the field
                // also has known values, emit each `key=value` so the
                // value-picker stage has concrete suggestions. Mirrors
                // the real-world pattern (`tailor-sdk api`) where a
                // proto descriptor pre-enumerates both the field and
                // its enum values.
                out.push({ value: `${f.key}=`, description: `Set ${f.key}` });
                for (const v of f.values ?? []) {
                  out.push({ value: `${f.key}=${v}`, description: `Set ${f.key} to ${v}` });
                }
              }
              return out;
            },
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
    name: "tailor-expand",
    description: "Mock CLI demonstrating pre-enumerated value completion.",
    subCommands: { api: apiCommand },
  }),
);

if (process.argv[1]?.includes("28-expand-completion")) {
  runMain(cli, { version: "1.0.0" });
}
