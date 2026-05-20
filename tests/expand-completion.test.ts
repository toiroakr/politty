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
      // `endpoint` is a local positional, so the lookup reads only the
      // local bucket — no global fallback.
      expect(script).toContain(`local _key="\${_arg_values[endpoint]:-}"`);
      expect(script).toContain("local -A _arg_values=()");
    });

    it("drops global tracker cases at frames where a local option shadows the global dep", () => {
      // Global `field` depends on global `env`. The subcommand defines a
      // local `env` that takes over `--env` at that frame. The bash
      // scanner must not record the local's value into
      // `_global_arg_values.env`, otherwise the global host's lookup
      // sees a value the runtime never wrote there.
      const globals = z.object({
        env: arg(z.string(), { completion: { custom: { choices: ["prod"] } } }),
        field: arg(z.string().optional(), {
          completion: {
            custom: {
              expand: { dependsOn: ["env"], enumerate: () => [{ value: "x" }] },
            },
          },
        }),
      });
      const cliShadow = defineCommand({
        name: "mycli",
        subCommands: {
          sub: defineCommand({
            name: "sub",
            args: z.object({
              env: arg(z.string(), { completion: { custom: { choices: ["a"] } } }),
            }),
            run: () => {},
          }),
        },
      });
      const { script: bash } = generateBashCompletion(cliShadow, {
        shell: "bash",
        programName: "mycli",
        globalArgsSchema: globals,
      });
      // Only the root path's `--env` writes into `_global_arg_values`.
      // The subcommand path must NOT appear in the global tracker.
      expect(bash).toContain(`:--env) _global_arg_values[env]="$3"`);
      expect(bash).not.toContain(`sub:--env) _global_arg_values[env]`);
    });

    it("keeps a global expand spec reading from the global bucket even when a subcommand shadows the dep name", () => {
      // Global `field` depends on global `env`. The subcommand defines a
      // local `env` that shadows the global at that frame. The host's
      // generated lookup must still read `_global_arg_values[env]`, not
      // the shadowed local — otherwise candidates supplied before the
      // subcommand disappear.
      const globals = z.object({
        env: arg(z.string(), { completion: { custom: { choices: ["prod", "stg"] } } }),
        field: arg(z.string().optional(), {
          completion: {
            custom: {
              expand: { dependsOn: ["env"], enumerate: () => [{ value: "x" }] },
            },
          },
        }),
      });
      const cliShadow = defineCommand({
        name: "mycli",
        subCommands: {
          sub: defineCommand({
            name: "sub",
            args: z.object({
              env: arg(z.string(), { completion: { custom: { choices: ["a"] } } }),
            }),
            run: () => {},
          }),
        },
      });
      const { script: bash } = generateBashCompletion(cliShadow, {
        shell: "bash",
        programName: "mycli",
        globalArgsSchema: globals,
      });
      // The global host's dep lookup must point at the global bucket.
      expect(bash).toContain(`local _key="\${_global_arg_values[env]:-}"`);
      // The dep tracker for the global `env` must also write to the
      // global bucket — both at root and at the `sub:--env` route.
      expect(bash).toContain(`:--env) _global_arg_values[env]="$3"`);
    });

    it("reads global deps from the global bucket and local deps from the local bucket", () => {
      // When a spec has a global dep, the lookup must read
      // `_global_arg_values[<d>]` only; when it has a local dep, read
      // `_arg_values[<d>]` only. A local dep falling back to a same-
      // named global would silently substitute a parent value for a
      // missing local value.
      const globalEnv = z.object({
        env: arg(z.string(), { completion: { custom: { choices: ["prod", "stg"] } } }),
        feat: arg(z.array(z.string()).default([]), {
          completion: {
            custom: {
              expand: { dependsOn: ["env"], enumerate: () => [{ value: "x" }] },
            },
          },
        }),
      });
      const cliMixed = defineCommand({
        name: "mycli",
        subCommands: {
          sub: defineCommand({
            name: "sub",
            args: z.object({
              env: arg(z.string(), { completion: { custom: { choices: ["a", "b"] } } }),
              localField: arg(z.string().optional(), {
                completion: {
                  custom: {
                    expand: { dependsOn: ["env"], enumerate: () => [{ value: "y" }] },
                  },
                },
              }),
            }),
            run: () => {},
          }),
        },
      });
      const { script: bash } = generateBashCompletion(cliMixed, {
        shell: "bash",
        programName: "mycli",
        globalArgsSchema: globalEnv,
      });
      // The global host (feat) reads the global bucket for its dep.
      expect(bash).toContain(`local _key="\${_global_arg_values[env]:-}"`);
      // The local host (localField on sub) reads the local bucket for its
      // dep — no fallback to globals.
      expect(bash).toContain(`local _key="\${_arg_values[env]:-}"`);
    });

    it("routes global tracker writes to a bucket that survives subcommand descent", () => {
      // A global expand spec (host + dep both global) must keep both the
      // sibling value and the dedup bucket alive after the scanner enters
      // a subcommand — otherwise `cli --env prod sub --field <TAB>` loses
      // the parent-level `--env` reading and emits no candidates.
      const globalEnv = z.object({
        env: arg(z.string(), { completion: { custom: { choices: ["prod", "stg"] } } }),
        field: arg(z.array(z.string()).default([]), {
          alias: "f",
          completion: {
            custom: {
              expand: { dependsOn: ["env"], enumerate: () => [{ value: "x=" }] },
            },
          },
        }),
      });
      const cliWithGlobals = defineCommand({
        name: "mycli",
        subCommands: {
          sub: defineCommand({ name: "sub", args: z.object({}), run: () => {} }),
        },
      });

      const { script: bash } = generateBashCompletion(cliWithGlobals, {
        shell: "bash",
        programName: "mycli",
        globalArgsSchema: globalEnv,
      });
      // Global tracker writes route into _global_arg_values, which is not
      // cleared on subcommand descent.
      expect(bash).toContain(`_global_arg_values[env]="$3"`);
      expect(bash).toContain(`_global_used_field_keys[field]+=" $_k "`);
      expect(bash).toContain("local -A _global_arg_values=()");

      const { script: zsh } = generateZshCompletion(cliWithGlobals, {
        shell: "zsh",
        programName: "mycli",
        globalArgsSchema: globalEnv,
      });
      expect(zsh).toContain(`_global_arg_values[env]="$3"`);
      expect(zsh).toContain(`_global_used_field_keys[field]+=" $_k "`);

      const { script: fish } = generateFishCompletion(cliWithGlobals, {
        shell: "fish",
        programName: "mycli",
        globalArgsSchema: globalEnv,
      });
      expect(fish).toContain('set -g _global_arg_values_env "$argv[3]"');
      expect(fish).toContain("set -ga _global_used_field_keys_field");
    });

    it("clears sibling-tracker state on subcommand descent so values do not bleed across frames", () => {
      const nested = defineCommand({
        name: "mycli",
        args: z.object({
          env: arg(z.string(), { completion: { custom: { choices: ["prod", "stg"] } } }),
        }),
        subCommands: {
          deploy: defineCommand({
            name: "deploy",
            args: z.object({
              env: arg(z.string(), { completion: { custom: { choices: ["prod", "stg"] } } }),
              field: arg(z.string().optional(), {
                completion: {
                  custom: {
                    expand: { dependsOn: ["env"], enumerate: () => [{ value: "x" }] },
                  },
                },
              }),
            }),
            run: () => {},
          }),
        },
      });
      const { script: bash } = generateBashCompletion(nested, {
        shell: "bash",
        programName: "mycli",
      });
      // The descent branch must reset `_arg_values` so the parent's --env
      // does not pre-populate the child's expand dep.
      expect(bash).toContain(`_arg_values=()`);
      const { script: zsh } = generateZshCompletion(nested, {
        shell: "zsh",
        programName: "mycli",
      });
      expect(zsh).toContain(`_arg_values=()`);
      const { script: fish } = generateFishCompletion(nested, {
        shell: "fish",
        programName: "mycli",
      });
      // Fish stores trackers in per-field globals — clearing them on
      // descent requires erasing each known tracked field.
      expect(fish).toMatch(/if __mycli_is_subcmd[\s\S]*?set -e _arg_values_env/);
    });

    it("tracks positionals supplied after `--` so expand deps still resolve", () => {
      const { script: bash } = generateBashCompletion(cmd, {
        shell: "bash",
        programName: "mycli",
      });
      expect(bash).toContain(`__mycli_track_pos "$_subcmd" "$_pos_count" "$_w"`);
      // The scanner's `if (( _after_dd ))` branch should call __track_pos
      // before incrementing the count, otherwise `cli -- GetApplication
      // <TAB>` yields no expand candidates.
      expect(bash).toMatch(/if \(\( _after_dd \)\); then __mycli_track_pos[^\n]*_pos_count\+\+/);

      const { script: zsh } = generateZshCompletion(cmd, {
        shell: "zsh",
        programName: "mycli",
      });
      expect(zsh).toMatch(/if \(\( _after_dd \)\); then __mycli_track_pos[^\n]*_pos_count\+\+/);

      const { script: fish } = generateFishCompletion(cmd, {
        shell: "fish",
        programName: "mycli",
      });
      expect(fish).toMatch(/if test \$_after_dd -eq 1; __mycli_track_pos[^\n]*math \$_pos_count/);
    });

    it("bash suppresses file fallback for expand specs with no candidates", () => {
      const { script } = generateBashCompletion(cmd, { shell: "bash", programName: "mycli" });
      // The expand block must `compopt +o default` before the early return
      // so an empty result does not silently degrade to file completion.
      // Match the directive appearing before the `_key=` declaration.
      expect(script).toMatch(/compopt \+o default[\s\S]*?local _key=/);
    });

    it("bash guards against an empty subscript when the dep is unset", () => {
      const { script } = generateBashCompletion(cmd, { shell: "bash", programName: "mycli" });
      // Without this guard, `api -f <TAB>` (endpoint not typed yet) would
      // dereference `${arr[]}` and bash errors out with `bad array subscript`.
      expect(script).toMatch(/if \[\[ -z "\$_key" \]\]; then return; fi/);
    });

    it("zsh inlines a hoisted associative array with descriptions", () => {
      const { script } = generateZshCompletion(cmd, { shell: "zsh", programName: "mycli" });
      expect(script).toContain("typeset -gA __mycli_expand_api__field=(");
      expect(script).toContain("workspaceId=:Set workspaceId");
      expect(script).toContain("__mycli_track_pos");
    });

    it("fish emits an inline switch and tracker function", () => {
      const { script } = generateFishCompletion(cmd, { shell: "fish", programName: "mycli" });
      // `endpoint` is a local positional, so the dep expression reads
      // only the local tracker variable.
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

  describe("array option deduplication", () => {
    const cmd = defineCommand({
      name: "mycli",
      subCommands: { api: makeApi() },
    });

    it("flags array expand specs on the collector", () => {
      const data = extractCompletionData(cmd, "mycli");
      const specs = collectExpandSpecs(data.command);
      expect(specs[0]?.isArrayOption).toBe(true);
      expect(specs[0]?.optionTokens).toEqual(["--field", "-f"]);
    });

    it("bash emits a separate track function and runtime dedup guard", () => {
      const { script } = generateBashCompletion(cmd, { shell: "bash", programName: "mycli" });
      expect(script).toContain("__mycli_track_array_expand");
      expect(script).toContain("local -A _used_field_keys=()");
      expect(script).toContain(`api:--field|api:-f)`);
      expect(script).toContain(`_used_field_keys[field]+=" $_k "`);
      expect(script).toContain(`_used_field_keys[field]:-`);
      expect(script).toContain(`__mycli_track_array_expand "$_subcmd"`);
    });

    it("zsh emits a separate track function and runtime dedup guard", () => {
      const { script } = generateZshCompletion(cmd, { shell: "zsh", programName: "mycli" });
      expect(script).toContain("__mycli_track_array_expand");
      expect(script).toContain("local -A _used_field_keys=()");
      expect(script).toContain(`_used_field_keys[field]+=" $_k "`);
      expect(script).toContain(`_used_field_keys[field]:-`);
    });

    it("fish emits per-field global lists and static per-candidate guards", () => {
      const { script } = generateFishCompletion(cmd, { shell: "fish", programName: "mycli" });
      expect(script).toContain("__mycli_track_array_expand");
      expect(script).toContain("set -e _used_field_keys_field");
      expect(script).toContain("set -ga _used_field_keys_field");
      expect(script).toContain('if not contains -- "workspaceId" $_used_field_keys_field');
    });

    it("accepts the short inline `-e=value` form in the scanner so `-e=prod` is tracked", () => {
      const { script: bash } = generateBashCompletion(cmd, {
        shell: "bash",
        programName: "mycli",
      });
      // The inline-with-value branch must match `-X=value` too — the
      // runtime parser accepts `-e=prod` and the tracker should record
      // the dep value the same way it would for `--env=prod`.
      expect(bash).toContain(`if [[ "$_w" == -*=* ]]; then`);
      expect(bash).not.toContain(`if [[ "$_w" == --*=* ]]; then`);

      const { script: zsh } = generateZshCompletion(cmd, {
        shell: "zsh",
        programName: "mycli",
      });
      expect(zsh).toContain(`if [[ "$_w" == -*=* ]]; then`);
      expect(zsh).not.toContain(`if [[ "$_w" == --*=* ]]; then`);

      const { script: fish } = generateFishCompletion(cmd, {
        shell: "fish",
        programName: "mycli",
      });
      expect(fish).toContain(`string match -q -- '-*=*' "$_w"`);
      expect(fish).not.toContain(`string match -q -- '--*=*' "$_w"`);
    });

    it("emits tracker cases for every alias-expanded subcommand path", () => {
      const cli = defineCommand({
        name: "mycli",
        subCommands: {
          api: defineCommand({
            name: "api",
            aliases: ["a"],
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
                        const ep = deps.endpoint ?? "";
                        return (ENDPOINT_FIELDS[ep] ?? []).map((k) => ({ value: `${k}=` }));
                      },
                    },
                  },
                },
              }),
            }),
            run: () => {},
          }),
        },
      });

      const data = extractCompletionData(cli, "mycli");
      const specs = collectExpandSpecs(data.command);
      expect(specs[0]?.pathStrs).toEqual(["api", "a"]);
      const tracked = collectTrackedFields(data.command, specs);
      expect(tracked[0]?.pathStrs).toEqual(["api", "a"]);

      const { script: bash } = generateBashCompletion(cli, {
        shell: "bash",
        programName: "mycli",
      });
      expect(bash).toContain(`api:0|a:0) _arg_values[endpoint]="$3"`);
      expect(bash).toContain(`api:--field|api:-f|a:--field|a:-f)`);

      const { script: zsh } = generateZshCompletion(cli, {
        shell: "zsh",
        programName: "mycli",
      });
      expect(zsh).toContain(`api:0|a:0) _arg_values[endpoint]="$3"`);
      expect(zsh).toContain(`api:--field|api:-f|a:--field|a:-f)`);

      const { script: fish } = generateFishCompletion(cli, {
        shell: "fish",
        programName: "mycli",
      });
      expect(fish).toContain(`case "api:0" "a:0"`);
      expect(fish).toContain(`case "api:--field" "api:-f" "a:--field" "a:-f"`);
    });

    it("escapes glob metacharacters in fish expand case patterns", () => {
      const cli = defineCommand({
        name: "mycli",
        subCommands: {
          api: defineCommand({
            name: "api",
            args: z.object({
              endpoint: arg(z.string(), {
                positional: true,
                completion: { custom: { choices: ["prod*", "stg?", "dev[1]"] } },
              }),
              field: arg(z.string().optional(), {
                completion: {
                  custom: {
                    expand: {
                      dependsOn: ["endpoint"],
                      enumerate: () => [{ value: "x" }],
                    },
                  },
                },
              }),
            }),
            run: () => {},
          }),
        },
      });
      const { script: fish } = generateFishCompletion(cli, {
        shell: "fish",
        programName: "mycli",
      });
      // Without escaping, `case "prod*"` would also match runtime values
      // like "production".
      expect(fish).toContain(`case "prod\\*"`);
      expect(fish).toContain(`case "stg\\?"`);
      expect(fish).toContain(`case "dev\\[1\\]"`);
    });

    it("escapes colons in zsh expand candidate values", () => {
      const cli = defineCommand({
        name: "mycli",
        subCommands: {
          api: defineCommand({
            name: "api",
            args: z.object({
              endpoint: arg(z.string(), {
                positional: true,
                completion: { custom: { choices: ["UrlOps"] } },
              }),
              field: arg(z.string(), {
                completion: {
                  custom: {
                    expand: {
                      dependsOn: ["endpoint"],
                      enumerate: () => [
                        { value: "https://example.com:443", description: "https:endpoint" },
                        "ns:value",
                      ],
                    },
                  },
                },
              }),
            }),
            run: () => {},
          }),
        },
      });
      const { script: zsh } = generateZshCompletion(cli, {
        shell: "zsh",
        programName: "mycli",
      });
      // `:` inside the candidate must be backslash-escaped so `_describe`
      // does not parse the value's own colons as the value/description
      // separator. The unescaped `:` between value and description is the
      // real separator.
      expect(zsh).toContain("https\\\\://example.com\\\\:443:https\\\\:endpoint");
      expect(zsh).toContain("ns\\\\:value");
    });

    it("guards the array dedup tracker against the cursor word", () => {
      // `-f pageDirection=<TAB>` must not mark `pageDirection` as used —
      // otherwise the dedup guard hides the very candidates the user is
      // trying to select.
      const { script: bash } = generateBashCompletion(cmd, {
        shell: "bash",
        programName: "mycli",
      });
      expect(bash).toMatch(
        /if \(\( _j \+ 2 < \$\{#_words\[@\]\} \)\); then\s*\n\s*__mycli_track_array_expand/,
      );

      const { script: zsh } = generateZshCompletion(cmd, {
        shell: "zsh",
        programName: "mycli",
      });
      expect(zsh).toMatch(/if \(\( _j \+ 1 < CURRENT \)\); then\s*\n\s*__mycli_track_array_expand/);

      const { script: fish } = generateFishCompletion(cmd, {
        shell: "fish",
        programName: "mycli",
      });
      expect(fish).toMatch(/if test \$_j -lt \$_limit\s*\n\s*__mycli_track_array_expand/);
    });

    it("scalar option with expand does not emit dedup helpers", () => {
      const scalar = defineCommand({
        name: "scalarcli",
        subCommands: {
          api: defineCommand({
            name: "api",
            args: z.object({
              endpoint: arg(z.string(), {
                positional: true,
                completion: { custom: { choices: ENDPOINTS } },
              }),
              field: arg(z.string(), {
                alias: "f",
                completion: {
                  custom: {
                    expand: {
                      dependsOn: ["endpoint"],
                      enumerate: (deps) => {
                        const ep = deps.endpoint ?? "";
                        return (ENDPOINT_FIELDS[ep] ?? []).map((k) => ({ value: `${k}=` }));
                      },
                    },
                  },
                },
              }),
            }),
            run: () => {},
          }),
        },
      });
      const { script: bash } = generateBashCompletion(scalar, {
        shell: "bash",
        programName: "scalarcli",
      });
      expect(bash).not.toContain("_used_field_keys");
      expect(bash).not.toContain("__scalarcli_track_array_expand");

      const { script: zsh } = generateZshCompletion(scalar, {
        shell: "zsh",
        programName: "scalarcli",
      });
      expect(zsh).not.toContain("_used_field_keys");
      expect(zsh).not.toContain("__scalarcli_track_array_expand");

      const { script: fish } = generateFishCompletion(scalar, {
        shell: "fish",
        programName: "scalarcli",
      });
      expect(fish).not.toContain("_used_field_keys");
      expect(fish).not.toContain("__scalarcli_track_array_expand");
    });
  });
});
