import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CompletionDirective,
  generateCandidates,
  generateCompletion,
  parseCompletionContext,
  withCompletionCommand,
  type DynamicCompletionContext,
} from "../src/completion/index.js";
import { arg, defineCommand, runCommand } from "../src/index.js";

describe("Dynamic completion (in-process resolver)", () => {
  describe("resolveValueCompletion exclusivity", () => {
    it("throws when resolve is combined with choices", () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                choices: ["a", "b"],
                resolve: () => ({ candidates: [] }),
              },
            },
          }),
        }),
        run: () => {},
      });

      // Forces resolveValueCompletion to fire on the schema
      expect(() => parseCompletionContext(["--field", ""], cmd)).toThrow(
        /completion\.custom may only specify one of/,
      );
    });

    it("throws when resolve is combined with shellCommand", () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                shellCommand: "printf 'a'",
                resolve: () => ({ candidates: [] }),
              },
            },
          }),
        }),
        run: () => {},
      });

      expect(() => parseCompletionContext(["--field", ""], cmd)).toThrow(
        /completion\.custom may only specify one of/,
      );
    });

    it("includes the field name in the error message", () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          myField: arg(z.string(), {
            completion: {
              custom: {
                choices: ["x"],
                resolve: () => ({ candidates: [] }),
              },
            },
          }),
        }),
        run: () => {},
      });

      expect(() => parseCompletionContext(["--my-field", ""], cmd)).toThrow(/Field "myField"/);
    });
  });

  describe("parseCompletionContext value collection", () => {
    const cmd = defineCommand({
      name: "mycli",
      args: z.object({
        endpoint: arg(z.string(), { positional: true }),
        verbose: arg(z.boolean().default(false), { alias: "v" }),
        config: arg(z.string().optional(), { alias: "c" }),
        field: arg(z.array(z.string()).default([]), { alias: "f" }),
      }),
      run: () => {},
    });

    it("captures positional value as parsedArgs", () => {
      const ctx = parseCompletionContext(["GetApplication", "--field", ""], cmd);
      expect(ctx.parsedArgs.endpoint).toBe("GetApplication");
    });

    it("captures scalar option values as parsedArgs", () => {
      const ctx = parseCompletionContext(["foo", "--config", "tailor.yml", "--field", ""], cmd);
      expect(ctx.parsedArgs.config).toBe("tailor.yml");
    });

    it("aggregates array option values into a list", () => {
      const ctx = parseCompletionContext(["foo", "-f", "a", "-f", "b", "-f", ""], cmd);
      expect(ctx.parsedArgs.field).toEqual(["a", "b"]);
    });

    it("populates previousValues for repeated array options", () => {
      const ctx = parseCompletionContext(["foo", "-f", "a", "-f", "b", "-f", ""], cmd);
      expect(ctx.previousValues).toEqual(["a", "b"]);
    });

    it("captures inline option value (--config=foo)", () => {
      const ctx = parseCompletionContext(["foo", "--config=tailor.yml", "--field", ""], cmd);
      expect(ctx.parsedArgs.config).toBe("tailor.yml");
    });

    it("resets parsedArgs when descending into a subcommand", () => {
      const parent = defineCommand({
        name: "mycli",
        args: z.object({ root: arg(z.string().optional(), { alias: "r" }) }),
        subCommands: {
          api: defineCommand({
            name: "api",
            args: z.object({
              endpoint: arg(z.string(), { positional: true }),
            }),
            run: () => {},
          }),
        },
      });
      const ctx = parseCompletionContext(["--root", "rrr", "api", "Get", ""], parent);
      // After entering `api` subcommand, root option from parent should not bleed in.
      expect(ctx.parsedArgs.root).toBeUndefined();
      expect(ctx.parsedArgs.endpoint).toBe("Get");
    });
  });

  describe("generateCandidates dynamic branch", () => {
    it("invokes a synchronous resolver and returns its candidates", async () => {
      let captured: DynamicCompletionContext | undefined;
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                resolve: (ctx) => {
                  captured = ctx;
                  return { candidates: ["one", "two", "three"] };
                },
              },
            },
          }),
        }),
        run: () => {},
      });

      const ctx = parseCompletionContext(["--field", ""], cmd);
      const result = await generateCandidates(ctx, { shell: "bash" });

      expect(result.candidates.map((c) => c.value)).toEqual(["one", "two", "three"]);
      expect(captured?.shell).toBe("bash");
      // Default directive should opt out of file completion and request prefix filtering.
      expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
      expect(result.directive & CompletionDirective.FilterPrefix).toBeTruthy();
    });

    it("awaits an async resolver", async () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                resolve: async () => {
                  await Promise.resolve();
                  return { candidates: ["async-one"] };
                },
              },
            },
          }),
        }),
        run: () => {},
      });

      const ctx = parseCompletionContext(["--field", ""], cmd);
      const result = await generateCandidates(ctx, { shell: "bash" });
      expect(result.candidates.map((c) => c.value)).toEqual(["async-one"]);
    });

    it("forwards parsedArgs and previousValues to the resolver", async () => {
      let captured: DynamicCompletionContext | undefined;
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          endpoint: arg(z.string(), { positional: true }),
          field: arg(z.array(z.string()).default([]), {
            alias: "f",
            completion: {
              custom: {
                resolve: (c) => {
                  captured = c;
                  return { candidates: [] };
                },
              },
            },
          }),
        }),
        run: () => {},
      });

      const ctx = parseCompletionContext(["GetApplication", "-f", "workspaceId", "-f", ""], cmd);
      await generateCandidates(ctx, { shell: "zsh" });
      expect(captured?.parsedArgs.endpoint).toBe("GetApplication");
      expect(captured?.previousValues).toEqual(["workspaceId"]);
    });

    it("accepts {value, description} candidate objects", async () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                resolve: () => ({
                  candidates: [{ value: "id", description: "Identifier" }, "name"],
                }),
              },
            },
          }),
        }),
        run: () => {},
      });

      const ctx = parseCompletionContext(["--field", ""], cmd);
      const result = await generateCandidates(ctx, { shell: "fish" });
      const idCand = result.candidates.find((c) => c.value === "id");
      expect(idCand?.description).toBe("Identifier");
      const nameCand = result.candidates.find((c) => c.value === "name");
      expect(nameCand?.description).toBeUndefined();
    });

    it("returns empty candidates with Error directive when resolver throws", async () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                resolve: () => {
                  throw new Error("boom");
                },
              },
            },
          }),
        }),
        run: () => {},
      });

      const ctx = parseCompletionContext(["--field", ""], cmd);
      const result = await generateCandidates(ctx, { shell: "bash" });
      expect(result.candidates).toEqual([]);
      expect(result.directive & CompletionDirective.Error).toBeTruthy();
    });

    it("respects directive override from resolver", async () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                resolve: () => ({
                  candidates: ["x"],
                  directive: CompletionDirective.KeepOrder,
                }),
              },
            },
          }),
        }),
        run: () => {},
      });

      const ctx = parseCompletionContext(["--field", ""], cmd);
      const result = await generateCandidates(ctx, { shell: "bash" });
      expect(result.directive).toBe(CompletionDirective.KeepOrder);
    });

    it("strips inline `--field=` prefix before passing currentWord", async () => {
      let captured: DynamicCompletionContext | undefined;
      const cmd = withCompletionCommand(
        defineCommand({
          name: "mycli",
          args: z.object({
            field: arg(z.string(), {
              completion: {
                custom: {
                  resolve: (c) => {
                    captured = c;
                    return { candidates: [`${c.currentWord}-resolved`] };
                  },
                },
              },
            }),
          }),
          run: () => {},
        }),
      );

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await runCommand(cmd, ["__complete", "--shell", "bash", "--", "--field=foo"]);
      consoleSpy.mockRestore();

      expect(captured?.currentWord).toBe("foo");
    });
  });

  describe("__complete end-to-end via runCommand", () => {
    it("emits resolver candidates with parsedArgs and previousValues populated", async () => {
      const cmd = withCompletionCommand(
        defineCommand({
          name: "mycli",
          args: z.object({
            endpoint: arg(z.string(), { positional: true }),
            field: arg(z.array(z.string()).default([]), {
              alias: "f",
              completion: {
                custom: {
                  resolve: ({ parsedArgs, previousValues }) => {
                    if (parsedArgs.endpoint !== "GetApplication") return { candidates: [] };
                    const all = ["workspaceId", "applicationName"];
                    return { candidates: all.filter((c) => !previousValues.includes(c)) };
                  },
                },
              },
            }),
          }),
          run: () => {},
        }),
      );

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await runCommand(cmd, [
        "__complete",
        "--shell",
        "bash",
        "--",
        "GetApplication",
        "-f",
        "workspaceId",
        "-f",
        "",
      ]);
      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      consoleSpy.mockRestore();

      const lines = output.split("\n");
      expect(lines).toContain("applicationName");
      expect(lines).not.toContain("workspaceId");
      // Trailing directive line
      expect(lines.at(-1)).toMatch(/^:\d+$/);
    });
  });

  describe("Static shell scripts", () => {
    const dynamicCmd = defineCommand({
      name: "mycli",
      args: z.object({
        endpoint: arg(z.string(), { positional: true }),
        field: arg(z.string().optional(), {
          alias: "f",
          completion: {
            custom: { resolve: () => ({ candidates: [] }) },
          },
        }),
      }),
      run: () => {},
    });

    const staticCmd = defineCommand({
      name: "mycli",
      args: z.object({
        env: arg(z.string(), {
          completion: { custom: { choices: ["a", "b"] } },
        }),
      }),
      run: () => {},
    });

    it("bash: emits invoke_complete helper only when dynamic specs exist", () => {
      const dyn = generateCompletion(dynamicCmd, { shell: "bash", programName: "mycli" }).script;
      const stat = generateCompletion(staticCmd, { shell: "bash", programName: "mycli" }).script;

      expect(dyn).toContain("__mycli_invoke_complete");
      expect(dyn).toContain("__mycli_apply_dynamic_output");
      expect(stat).not.toContain("__mycli_invoke_complete");
    });

    it("zsh: emits filter helper only when dynamic specs exist", () => {
      const dyn = generateCompletion(dynamicCmd, { shell: "zsh", programName: "mycli" }).script;
      const stat = generateCompletion(staticCmd, { shell: "zsh", programName: "mycli" }).script;

      expect(dyn).toContain("__mycli_invoke_complete");
      expect(dyn).toContain("__mycli_filter_dynamic_lines");
      expect(stat).not.toContain("__mycli_invoke_complete");
    });

    it("fish: emits filter helper only when dynamic specs exist", () => {
      const dyn = generateCompletion(dynamicCmd, { shell: "fish", programName: "mycli" }).script;
      const stat = generateCompletion(staticCmd, { shell: "fish", programName: "mycli" }).script;

      expect(dyn).toContain("__mycli_invoke_complete");
      expect(dyn).toContain("__mycli_filter_dynamic_lines");
      expect(stat).not.toContain("__mycli_invoke_complete");
    });

    it("supports MYCLI_BIN override in bash script", () => {
      const dyn = generateCompletion(dynamicCmd, { shell: "bash", programName: "mycli" }).script;
      expect(dyn).toContain("${MYCLI_BIN:-mycli}");
    });
  });
});
