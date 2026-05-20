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

    it("bash inlines hoisted prefix-scalar entries and a tracker case", () => {
      const { script } = generateBashCompletion(cmd, { shell: "bash", programName: "mycli" });
      // Bash 3.2 emits one scalar per table entry — no associative array.
      expect(script).toContain("__mycli_expand_api__field__GetApplication=");
      expect(script).not.toContain("declare -gA");
      expect(script).not.toContain("local -A");
      expect(script).not.toContain("mapfile");
      expect(script).toContain("__mycli_track_pos");
      expect(script).toContain(`api:0) _arg_values_endpoint="$3"`);
      // `endpoint` is a local positional, so the lookup reads only the
      // local prefix-scalar bucket — no global fallback.
      expect(script).toContain(`_enc_v="\${_arg_values_endpoint:-}"`);
    });

    it("keeps global tracker cases reachable through subcommand aliases", () => {
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
      const cliAlias = defineCommand({
        name: "mycli",
        subCommands: {
          deploy: defineCommand({
            name: "deploy",
            aliases: ["d"],
            args: z.object({}),
            run: () => {},
          }),
        },
      });
      const { script: bash } = generateBashCompletion(cliAlias, {
        shell: "bash",
        programName: "mycli",
        globalArgsSchema: globals,
      });
      // Aliased subcommand path `d:--env` must record into the global
      // bucket just like the canonical `deploy:--env`.
      expect(bash).toContain(`d:--env`);
      expect(bash).toContain(`deploy:--env`);
    });

    it("keeps non-colliding global tokens at a leaf where a multi-char local only shadows a same-named sibling", () => {
      // Global dep `env` has cliName "env" and alias "extra", so its
      // tokens are `--env` and `--extra`. A subcommand defines a
      // multi-char local cliName "envdiff" whose tokens are
      // `--envdiff` only. The raw names overlap on the leading "env"
      // segment but emitted tokens don't, so runtime still routes
      // `--env` / `--extra` to the global at this leaf.
      const globals = z.object({
        env: arg(z.string(), {
          alias: "extra",
          completion: { custom: { choices: ["prod"] } },
        }),
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
              envdiff: arg(z.string(), { completion: { custom: { choices: ["a"] } } }),
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
      expect(bash).toMatch(/sub:--env\b[^\n]*_global_arg_values_env/);
      expect(bash).toMatch(/sub:--extra\b[^\n]*_global_arg_values_env/);
    });

    it("drops only the colliding token when a local option overlaps one global alias", () => {
      // Global `env` has cliName "env" and single-char alias `e`,
      // emitting `--env` and `-e`. A subcommand defines a local option
      // whose own alias is `-e` (single-char), so the local also emits
      // `-e`. Runtime's `separateGlobalArgs` would route `-e` to the
      // local; `--env` still belongs to the global. The tracker must
      // keep `sub:--env` while dropping `sub:-e`.
      const globals = z.object({
        env: arg(z.string(), {
          alias: "e",
          completion: { custom: { choices: ["prod"] } },
        }),
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
              extra: arg(z.string(), {
                alias: "e",
                completion: { custom: { choices: ["a"] } },
              }),
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
      expect(bash).toMatch(/sub:--env\b[^\n]*_global_arg_values_env/);
      expect(bash).not.toMatch(/sub:-e\b[^\n]*_global_arg_values_env/);
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
      expect(bash).toContain(`:--env) _global_arg_values_env="$3"`);
      expect(bash).not.toContain(`sub:--env) _global_arg_values_env`);
    });

    it("keeps global tracker cases at intermediate frames where a local shadows the dep", () => {
      // Mirrors the iteration-18 shadow case but with a deeper command
      // tree. When `parent` defines a local `env` AND has a descendant
      // subcommand, the runtime's `scanForSubcommand` collects the
      // pre-boundary `--env` into globals (the scanner ignores the
      // parent's local schema). The generated script must keep writing
      // `_global_arg_values[env]` for the `parent:--env` pattern so a
      // global expand under `child` still sees the value typed before
      // descent.
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
      const cliNested = defineCommand({
        name: "mycli",
        subCommands: {
          parent: defineCommand({
            name: "parent",
            args: z.object({
              env: arg(z.string(), { completion: { custom: { choices: ["a"] } } }),
            }),
            subCommands: {
              child: defineCommand({
                name: "child",
                args: z.object({}),
                run: () => {},
              }),
            },
          }),
        },
      });
      const { script: bash } = generateBashCompletion(cliNested, {
        shell: "bash",
        programName: "mycli",
        globalArgsSchema: globals,
      });
      // The `parent:--env` pattern must reach the global-bucket write,
      // even though `parent` itself defines a local `env`. With the
      // intermediate-frame fix the pattern is unioned with the other
      // paths, so the action follows after the alternation.
      expect(bash).toMatch(/(?:^|\|)parent:--env(?:\||\))[^\n]*_global_arg_values_env/m);
      // The leaf-shadowed `sub:--env` style drop still applies elsewhere
      // — `child:--env` is the deepest leaf, and child has no local
      // shadow, so its case stays in.
      expect(bash).toMatch(/(?:^|\|)parent:child:--env(?:\||\))[^\n]*_global_arg_values_env/m);

      const { script: zsh } = generateZshCompletion(cliNested, {
        shell: "zsh",
        programName: "mycli",
        globalArgsSchema: globals,
      });
      expect(zsh).toMatch(/(?:^|\|)parent:--env(?:\||\))[^\n]*_global_arg_values\[env\]/m);

      const { script: fish } = generateFishCompletion(cliNested, {
        shell: "fish",
        programName: "mycli",
        globalArgsSchema: globals,
      });
      // Fish uses space-separated case patterns and per-field scalars.
      expect(fish).toMatch(/"parent:--env"[\s\S]*?set -g _global_arg_values_env/);
    });

    it("keeps a global expand spec reading from the global bucket even when a subcommand shadows the dep name", () => {
      // Global `field` depends on global `env`. The subcommand defines a
      // local `env` that shadows the global at that frame. The host's
      // generated lookup must still read `_global_arg_values_env`, not
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
      expect(bash).toContain(`_enc_v="\${_global_arg_values_env:-}"`);
      // The dep tracker for the global `env` must also write to the
      // global bucket — both at root and at the `sub:--env` route.
      expect(bash).toContain(`:--env) _global_arg_values_env="$3"`);
    });

    it("reads global deps from the global bucket and local deps from the local bucket", () => {
      // When a spec has a global dep, the lookup must read
      // `_global_arg_values_<d>` only; when it has a local dep, read
      // `_arg_values_<d>` only. A local dep falling back to a same-
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
      expect(bash).toContain(`_enc_v="\${_global_arg_values_env:-}"`);
      // The local host (localField on sub) reads the local bucket for its
      // dep — no fallback to globals.
      expect(bash).toContain(`_enc_v="\${_arg_values_env:-}"`);
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
      // cleared on subcommand descent (bash 3.2 uses prefix-scalar vars).
      expect(bash).toContain(`_global_arg_values_env="$3"`);
      expect(bash).toContain(`_global_used_field_keys_field+=" $_k "`);
      expect(bash).toContain("unset $(compgen -v _global_arg_values_");

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
      // The descent branch must reset `_arg_values_*` so the parent's
      // --env does not pre-populate the child's expand dep. Bash 3.2
      // uses prefix-scalar vars + compgen-driven unset; zsh keeps the
      // associative-array reset.
      expect(bash).toContain(`unset $(compgen -v _arg_values_`);
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
      // The expand block must `compopt +o default` before building the
      // encoded lookup key, so an empty result does not silently degrade
      // to file completion. Match the directive appearing before the
      // `_enc_key=` initialization.
      expect(script).toMatch(/compopt \+o default[\s\S]*?local _enc_key=/);
    });

    it("bash handles unset deps without bad-array-subscript errors", () => {
      const { script } = generateBashCompletion(cmd, { shell: "bash", programName: "mycli" });
      // The bash 3.2 path uses indirect expansion on a per-entry scalar
      // (`${!_varname:-}`), so an unset dep simply yields an empty
      // candidate set — no `${arr[]}` dereference to error on.
      expect(script).toMatch(/local _raw="\$\{!_varname:-\}"/);
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

    it("fish emits expand candidates via printf so `-n`-like values survive", () => {
      // fish's `echo` swallows leading `-n`/`-e`/`-s`/`-E` as flags. A
      // resolver-supplied or expand candidate may legitimately equal one
      // of those, so the emitter must use `printf '%s\\n'` (or `echo --`).
      const cli = defineCommand({
        name: "mycli",
        args: z.object({
          endpoint: arg(z.string(), {
            positional: true,
            completion: { custom: { choices: ["GetApplication"] } },
          }),
          field: arg(z.string().optional(), {
            completion: {
              custom: {
                expand: {
                  dependsOn: ["endpoint"],
                  enumerate: () => [{ value: "-n" }, { value: "-e", description: "echo flag" }],
                },
              },
            },
          }),
        }),
      });
      const { script } = generateFishCompletion(cli, {
        shell: "fish",
        programName: "mycli",
      });
      expect(script).toContain(`printf '%s\\n' "-n"`);
      expect(script).toContain(`printf '%s\\t%s\\n' "-e" "echo flag"`);
      expect(script).not.toMatch(/^\s*echo "-n"/m);
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
      // Bash 3.2: prefix-scalar per-field bucket, not an associative array.
      expect(script).toContain("unset $(compgen -v _used_field_keys_");
      expect(script).toContain(`api:--field|api:-f)`);
      expect(script).toContain(`_used_field_keys_field+=" $_k "`);
      expect(script).toContain(`_used_field_keys_field:-`);
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
      expect(bash).toContain(`api:0|a:0) _arg_values_endpoint="$3"`);
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

  describe("bash 3.2 compatibility", () => {
    it("generated bash script for expand uses no bash 4+ idioms", () => {
      // Sanity guard: macOS ships bash 3.2.57 and many users source the
      // generated completion straight from /bin/bash. The expand path
      // must avoid declare -A, declare -gA, local -A, mapfile, readarray.
      const cli = defineCommand({
        name: "mycli",
        subCommands: { api: makeApi() },
      });
      const { script } = generateBashCompletion(cli, {
        shell: "bash",
        programName: "mycli",
      });
      expect(script).not.toMatch(/\bdeclare\s+-gA\b/);
      expect(script).not.toMatch(/\bdeclare\s+-A\b/);
      expect(script).not.toMatch(/\blocal\s+-A\b/);
      expect(script).not.toMatch(/\bmapfile\b/);
      expect(script).not.toMatch(/\breadarray\b/);
    });

    it("multi-dep expand keys encode each dep independently", () => {
      // Two deps with shared characters could collide under a naive
      // concat encoding (e.g. "ab" + "c" vs "a" + "bc"). The per-dep
      // hex encoding plus `_` separator keeps the keys disjoint.
      const cli = defineCommand({
        name: "mycli",
        args: z.object({
          a: arg(z.string(), { completion: { custom: { choices: ["x"] } } }),
          b: arg(z.string(), { completion: { custom: { choices: ["y"] } } }),
          out: arg(z.string().optional(), {
            completion: {
              custom: {
                expand: {
                  dependsOn: ["a", "b"],
                  enumerate: (deps) => [{ value: `${deps.a}-${deps.b}` }],
                },
              },
            },
          }),
        }),
      });
      const { script } = generateBashCompletion(cli, {
        shell: "bash",
        programName: "mycli",
      });
      // Each dep value contributes one segment to the encoded key, joined
      // with `_`. For deps ("x", "y") the suffix is "x_y".
      expect(script).toContain(`__mycli_expand_root__out__x_y=`);
      // Lookup composes the suffix from runtime values via `__mycli_enc`.
      expect(script).toContain(`_enc_v="\${_arg_values_a:-}"`);
      expect(script).toContain(`_enc_key="$(__mycli_enc "$_enc_v")"`);
      expect(script).toContain(`_enc_key+="_$(__mycli_enc "$_enc_v")"`);
    });

    it("fish multi-dep case keys split each segment so `\\x1f` stays outside double quotes", () => {
      // Fish does not interpret `\x` escapes inside double quotes, so a
      // case pattern like `"k1\x1fk2"` waits for the literal four-character
      // sequence `\x1f` and never matches the switch expression (which
      // carries an actual 0x1f byte between segments). The fix joins
      // double-quoted segments with an UNQUOTED `\x1f`, mirroring the
      // switch expression's layout.
      const cli = defineCommand({
        name: "mycli",
        args: z.object({
          a: arg(z.string(), { completion: { custom: { choices: ["x"] } } }),
          b: arg(z.string(), { completion: { custom: { choices: ["y"] } } }),
          out: arg(z.string().optional(), {
            completion: {
              custom: {
                expand: {
                  dependsOn: ["a", "b"],
                  enumerate: (deps) => [{ value: `out-${deps.a}-${deps.b}` }],
                },
              },
            },
          }),
        }),
      });
      const { script } = generateFishCompletion(cli, {
        shell: "fish",
        programName: "mycli",
      });
      expect(script).toContain(`switch "$_arg_values_a"\\x1f"$_arg_values_b"`);
      expect(script).toContain(`case "x"\\x1f"y"`);
      expect(script).not.toMatch(/case "[^"]*\\x1f[^"]*"/);
    });

    it("seeds an empty COMPREPLY sentinel for empty bash expand results so 3.2 does not file-fall-back", () => {
      // Bash 3.2 lacks compopt, so the inline expand path's
      // `compopt +o default 2>/dev/null` is a silent no-op. Two empty
      // outcomes — the lookup yielding no entry AND the filter loop
      // dropping every candidate — both need COMPREPLY to be left
      // non-empty (here: a single empty string) so the script's
      // `complete -o default` registration does not fall back to
      // filename completion.
      const cli = defineCommand({
        name: "mycli",
        args: z.object({
          a: arg(z.string(), { completion: { custom: { choices: ["x"] } } }),
          out: arg(z.string().optional(), {
            completion: {
              custom: {
                expand: {
                  dependsOn: ["a"],
                  enumerate: () => [{ value: "only" }],
                },
              },
            },
          }),
        }),
      });
      const { script } = generateBashCompletion(cli, {
        shell: "bash",
        programName: "mycli",
      });
      expect(script).toMatch(
        /if \[\[ -n "\$_raw" \]\];[\s\S]*?fi\n\s*if \(\( \$\{#COMPREPLY\[@\]\} == 0 \)\); then COMPREPLY=\( "" \); fi/,
      );
    });

    it("emits both `--x` and `-x` tracker cases for a single-char cliName dep", () => {
      // Runtime accepts both `--x value` and `-x value` for a 1-char
      // cliName, so the generated tracker case for an expand dep of
      // that shape must list both tokens. Without the short token an
      // expand that depends on `x` works after `--x a` but not `-x a`.
      const cli = defineCommand({
        name: "mycli",
        args: z.object({
          x: arg(z.string(), { completion: { custom: { choices: ["a"] } } }),
          out: arg(z.string().optional(), {
            completion: {
              custom: {
                expand: { dependsOn: ["x"], enumerate: () => [{ value: "ok" }] },
              },
            },
          }),
        }),
      });
      const { script } = generateBashCompletion(cli, {
        shell: "bash",
        programName: "mycli",
      });
      expect(script).toMatch(/:--x\b[^\n]*_arg_values_x/);
      expect(script).toMatch(/:-x\b[^\n]*_arg_values_x/);
    });

    it("encodes `_` so dep values cannot collide with hex escapes or the join separator", () => {
      // If `_` passed through unchanged, dep `-` (→ `_2D`) would collide
      // with the literal dep `_2D`, and `(a, _b)` would render the same
      // suffix as `(a_, b)` thanks to the `_` join separator. Encoding
      // `_` as `_5F` keeps every dep tuple disjoint.
      const cli = defineCommand({
        name: "mycli",
        args: z.object({
          a: arg(z.string(), { completion: { custom: { choices: ["-", "_2D"] } } }),
          out: arg(z.string().optional(), {
            completion: {
              custom: {
                expand: {
                  dependsOn: ["a"],
                  enumerate: (deps) => [{ value: `out-${deps.a}` }],
                },
              },
            },
          }),
        }),
      });
      const { script } = generateBashCompletion(cli, {
        shell: "bash",
        programName: "mycli",
      });
      expect(script).toContain(`__mycli_expand_root__out___2D=`);
      expect(script).toContain(`__mycli_expand_root__out___5F2D=`);
      // The runtime encoder must agree — only `[a-zA-Z0-9]` passes through.
      expect(script).toContain(`[a-zA-Z0-9]) _r+="$_c" ;;`);
      expect(script).not.toMatch(/\[a-zA-Z0-9_\]\) _r\+="\$_c"/);
    });
  });
});
