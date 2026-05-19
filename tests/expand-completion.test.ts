import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateBashCompletion } from "../src/completion/bash.js";
import {
  collectExpandSpecs,
  collectTrackedFields,
  extractCompletionData,
} from "../src/completion/extractor.js";
import { generateFishCompletion } from "../src/completion/fish.js";
import { generateZshCompletion } from "../src/completion/zsh.js";
import { arg, defineCommand } from "../src/index.js";

const ENDPOINT_FIELDS: Record<string, string[]> = {
  GetApplication: ["workspaceId", "applicationName"],
  ListApplications: ["workspaceId", "first"],
};
const ENDPOINTS = Object.keys(ENDPOINT_FIELDS).sort();

function makeApi() {
  return defineCommand({
    name: "api",
    args: z.object({
      endpoint: arg(z.string(), {
        positional: true,
        completion: { custom: { choices: ENDPOINTS } },
      }),
      field: arg(z.array(z.string()).default([]), {
        alias: "f",
        completion: {
          custom: {
            expand: {
              dependsOn: ["endpoint"],
              enumerate: (deps) => {
                const endpoint = deps.endpoint ?? "";
                return (ENDPOINT_FIELDS[endpoint] ?? []).map((k) => ({
                  value: `${k}=`,
                  description: `Set ${k}`,
                }));
              },
            },
          },
        },
      }),
    }),
    run: () => {},
  });
}

describe("expand completion", () => {
  describe("extractor", () => {
    it("resolves expand into a baked table", () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: { api: makeApi() },
      });
      const data = extractCompletionData(cmd, "mycli");
      const api = data.command.subcommands.find((s) => s.name === "api");
      const field = api?.options.find((o) => o.name === "field");
      expect(field?.valueCompletion?.type).toBe("expand");
      if (field?.valueCompletion?.type !== "expand") throw new Error("unreachable");
      const table = field.valueCompletion.table;
      expect(table).toHaveLength(2);
      const get = table.find((e) => e.key[0] === "GetApplication");
      expect(get?.candidates.map((c) => c.value)).toEqual(["workspaceId=", "applicationName="]);
      expect(get?.candidates[0]?.description).toBe("Set workspaceId");
    });

    it("rejects dependsOn referring to a sibling without static choices", () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: {
          api: defineCommand({
            name: "api",
            args: z.object({
              dynamicField: arg(z.string(), {}),
              field: arg(z.string(), {
                completion: {
                  custom: {
                    expand: {
                      dependsOn: ["dynamicField"],
                      enumerate: () => [],
                    },
                  },
                },
              }),
            }),
            run: () => {},
          }),
        },
      });
      expect(() => extractCompletionData(cmd, "mycli")).toThrow(
        /dependsOn references "dynamicField"/,
      );
    });

    it("rejects dependsOn that includes the field itself", () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                expand: {
                  dependsOn: ["field"],
                  enumerate: () => [],
                },
              },
            },
          }),
        }),
        run: () => {},
      });
      expect(() => extractCompletionData(cmd, "mycli")).toThrow(
        /cannot reference the field itself/,
      );
    });

    it("rejects empty dependsOn", () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                expand: {
                  dependsOn: [],
                  enumerate: () => [],
                },
              },
            },
          }),
        }),
        run: () => {},
      });
      expect(() => extractCompletionData(cmd, "mycli")).toThrow(/must list at least one sibling/);
    });

    it("rejects mixing expand with other custom variants", () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          endpoint: arg(z.string(), {
            positional: true,
            completion: { custom: { choices: ["a"] } },
          }),
          field: arg(z.string(), {
            completion: {
              custom: {
                expand: { dependsOn: ["endpoint"], enumerate: () => [] },
                choices: ["a", "b"],
              },
            },
          }),
        }),
        run: () => {},
      });
      expect(() => extractCompletionData(cmd, "mycli")).toThrow(/may only specify one of/);
    });

    it("propagates enumerate errors with field context", () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          endpoint: arg(z.string(), {
            positional: true,
            completion: { custom: { choices: ["only"] } },
          }),
          field: arg(z.string(), {
            completion: {
              custom: {
                expand: {
                  dependsOn: ["endpoint"],
                  enumerate: () => {
                    throw new Error("boom");
                  },
                },
              },
            },
          }),
        }),
        run: () => {},
      });
      expect(() => extractCompletionData(cmd, "mycli")).toThrow(/enumerate threw.*boom/);
    });
  });

  describe("collectExpandSpecs / collectTrackedFields", () => {
    it("locates the expand spec and the positional sibling to track", () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: { api: makeApi() },
      });
      const data = extractCompletionData(cmd, "mycli");
      const specs = collectExpandSpecs(data.command);
      expect(specs).toHaveLength(1);
      expect(specs[0]?.fieldName).toBe("field");
      expect(specs[0]?.funcSuffix).toBe("api");
      expect(specs[0]?.pathStr).toBe("api");
      expect(specs[0]?.isPositional).toBe(false);

      const tracked = collectTrackedFields(data.command, specs);
      expect(tracked).toHaveLength(1);
      expect(tracked[0]?.fieldName).toBe("endpoint");
      expect(tracked[0]?.isPositional).toBe(true);
      expect(tracked[0]?.position).toBe(0);
      expect(tracked[0]?.pathStr).toBe("api");
    });
  });

  describe("shell generators", () => {
    const cmd = defineCommand({
      name: "mycli",
      subCommands: { api: makeApi() },
    });

    it("bash inlines a hoisted associative array and a tracker case", () => {
      const { script } = generateBashCompletion(cmd, { shell: "bash", programName: "mycli" });
      expect(script).toContain("declare -gA __mycli_expand_api__field=()");
      expect(script).toContain("__mycli_expand_api__field[$'GetApplication']");
      expect(script).toContain("__mycli_track_pos");
      expect(script).toContain(`api:0) _arg_values[endpoint]="$3"`);
      expect(script).toContain(`local _key="\${_arg_values[endpoint]:-}"`);
      expect(script).toContain("local -A _arg_values=()");
    });

    it("zsh inlines a hoisted associative array with descriptions", () => {
      const { script } = generateZshCompletion(cmd, { shell: "zsh", programName: "mycli" });
      expect(script).toContain("typeset -gA __mycli_expand_api__field=(");
      expect(script).toContain("workspaceId=:Set workspaceId");
      expect(script).toContain("__mycli_track_pos");
    });

    it("fish emits an inline switch and tracker function", () => {
      const { script } = generateFishCompletion(cmd, { shell: "fish", programName: "mycli" });
      expect(script).toContain('switch "$_arg_values_endpoint"');
      expect(script).toContain('case "GetApplication"');
      expect(script).toContain('set -g _arg_values_endpoint "$argv[3]"');
    });

    it("omits expand helpers when no expand specs are defined", () => {
      const simple = defineCommand({
        name: "simple",
        args: z.object({
          name: arg(z.string()),
        }),
        run: () => {},
      });
      const { script: bash } = generateBashCompletion(simple, {
        shell: "bash",
        programName: "simple",
      });
      expect(bash).not.toContain("_arg_values");
      expect(bash).not.toContain("__simple_track_opt");
    });
  });
});
