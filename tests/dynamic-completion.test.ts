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
import { arg, defineCommand, runCommand, type AnyCommand } from "../src/index.js";

/**
 * Run __complete on `cmd` with `argv` (everything after `--`) and return the
 * captured console output split into lines. Restores the spy on return.
 */
async function runComplete(
  cmd: AnyCommand,
  argv: string[],
  shell: "bash" | "zsh" | "fish" = "bash",
): Promise<string[]> {
  using consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await runCommand(cmd, ["__complete", "--shell", shell, "--", ...argv]);
  const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
  return output.split("\n");
}

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

    it("classifies short inline value `-f=` as option-value, not option-name", () => {
      // Runtime accepts `-f=value` for an option with `alias: "f"`.
      // The completion parser's Case 2 was matching `--` only, so
      // `parseCompletionContext(["-f=fo"], ...)` fell through to
      // option-name. Confirm the short inline shape now classifies as
      // option-value with the right target.
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            alias: "f",
            completion: { custom: { choices: ["alpha"] } },
          }),
        }),
        run: () => {},
      });
      const ctx = parseCompletionContext(["-f=fo"], cmd);
      expect(ctx.completionType).toBe("option-value");
      expect(ctx.targetOption?.name).toBe("field");
    });

    it("captures inline option value (--config=foo)", () => {
      const ctx = parseCompletionContext(["foo", "--config=tailor.yml", "--field", ""], cmd);
      expect(ctx.parsedArgs.config).toBe("tailor.yml");
    });

    it("does not consume the next option as a value when one option follows another", () => {
      // `parseArgv` does not consume a `-` prefixed token as the previous
      // option's value. Completion must mirror that — otherwise
      // `--config --verbose --field <TAB>` records `config === "--verbose"`
      // and leaves `verbose` unset, so the resolver sees a state the
      // runtime never produces.
      const ctx = parseCompletionContext(["--config", "--verbose", "--field", ""], cmd);
      expect(ctx.parsedArgs.config).toBeUndefined();
      expect(ctx.parsedArgs.verbose).toBe(true);
    });

    it("does not consume the trailing currentWord as an option value", () => {
      // The last argv element is the word being completed. It must not be
      // recorded as `--config`'s value, otherwise resolvers see a value the
      // user has not finished typing.
      const ctx = parseCompletionContext(["foo", "--config", "tailor.yml"], cmd);
      expect(ctx.parsedArgs.config).toBeUndefined();
      expect(ctx.currentWord).toBe("tailor.yml");
    });

    it("records boolean flags as `true` in parsedArgs", () => {
      const ctx = parseCompletionContext(["foo", "--verbose", "--field", ""], cmd);
      expect(ctx.parsedArgs.verbose).toBe(true);
    });

    it("records short boolean aliases as `true` in parsedArgs", () => {
      const ctx = parseCompletionContext(["foo", "-v", "--field", ""], cmd);
      expect(ctx.parsedArgs.verbose).toBe(true);
    });

    it("decomposes combined short boolean flags so each char is recorded", () => {
      // `parseArgv` accepts `-ab` as `-a -b` when both letters resolve to
      // boolean options. The completion parser must mirror that so a
      // resolver sees both flags as set.
      const cmd = defineCommand({
        name: "combinedcli",
        args: z.object({
          alpha: arg(z.boolean().default(false), { alias: "a" }),
          beta: arg(z.boolean().default(false), { alias: "b" }),
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      const ctx = parseCompletionContext(["-ab", "--field", ""], cmd);
      expect(ctx.parsedArgs.alpha).toBe(true);
      expect(ctx.parsedArgs.beta).toBe(true);
    });

    it("records negation flags as `false` in parsedArgs", () => {
      const negCmd = defineCommand({
        name: "negcli",
        args: z.object({
          cache: arg(z.boolean().default(true), { negation: true }),
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      const ctx = parseCompletionContext(["--no-cache", "--field", ""], negCmd);
      expect(ctx.parsedArgs.cache).toBe(false);
    });

    it("records alias-based opt-in negation forms as `false`", () => {
      // Runtime parser resolves the post-`no-` segment through aliasMap,
      // so `--no-c` and `--noC` both flip a boolean `cache` declared with
      // `alias: "c", negation: true`. The completion parser must mirror that
      // to keep resolver-visible flag state aligned.
      const aliasNegCmd = defineCommand({
        name: "negaliascli",
        args: z.object({
          cache: arg(z.boolean().default(true), { alias: "c", negation: true }),
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      const hyphenated = parseCompletionContext(["--no-c", "--field", ""], aliasNegCmd);
      expect(hyphenated.parsedArgs.cache).toBe(false);

      const camel = parseCompletionContext(["--noC", "--field", ""], aliasNegCmd);
      expect(camel.parsedArgs.cache).toBe(false);
    });

    it("does not record an implicit negation when the user opted out via `negation: false`", () => {
      const cmd = defineCommand({
        name: "negfalse",
        args: z.object({
          cache: arg(z.boolean().default(true), { negation: false }),
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      const ctx = parseCompletionContext(["--no-cache", "--field", ""], cmd);
      expect(ctx.parsedArgs.cache).toBeUndefined();
    });

    it("routes `-e` to the global when the local cliName is `e` without an explicit alias", () => {
      // Runtime's `separateGlobalArgs` harvests `-e` as the global
      // when a global has `alias: "e"` and the local declares only
      // `cliName: "e"` (no explicit alias — its aliasMap therefore
      // omits "e"). The completion parser must mirror that or
      // resolvers see the value under the local's name instead of
      // the global's.
      const globals = z.object({
        env: arg(z.string().optional(), { alias: "e" }),
      });
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          e: arg(z.string().optional()),
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      const ctx = parseCompletionContext(["-e", "prod", "--field", ""], cmd, globals);
      expect(ctx.parsedArgs.env).toBe("prod");
      expect(ctx.parsedArgs.e).toBeUndefined();
    });

    it("recognizes a single-character alias via both `-f` and `--f`", () => {
      // Runtime's `aliasMap` registers a 1-char alias as the canonical
      // mapping, and the long-form path consults the same map. So
      // `--f value` is valid for `alias: "f"`. The completion parser
      // must classify both forms as option-value to surface the
      // resolver for `__complete --shell bash -- --f <TAB>`.
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            alias: "f",
            completion: { custom: { choices: ["alpha"] } },
          }),
        }),
        run: () => {},
      });
      const shortCtx = parseCompletionContext(["-f", ""], cmd);
      expect(shortCtx.completionType).toBe("option-value");
      expect(shortCtx.targetOption?.name).toBe("field");

      const longCtx = parseCompletionContext(["--f", ""], cmd);
      expect(longCtx.completionType).toBe("option-value");
      expect(longCtx.targetOption?.name).toBe("field");
    });

    it("does not record a global as set when typed inside a combined short flag", () => {
      // Runtime's `scanForSubcommand` / `separateGlobalArgs` do NOT
      // decompose combined short flags — only the leaf local parser
      // does. So `-ab` with a global `-a` and local `-b` never actually
      // surfaces the global at runtime. The completion parser must
      // not record the global as `true` either.
      const globals = z.object({
        alpha: arg(z.boolean().default(false), { alias: "a" }),
      });
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          beta: arg(z.boolean().default(false), { alias: "b" }),
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      const ctx = parseCompletionContext(["-ab", "--field", ""], cmd, globals);
      expect(ctx.parsedArgs.alpha).toBeUndefined();
      // The local `beta` is decomposed via the local parser at runtime,
      // so the completion parser is free to record it; but the global
      // must stay unset.
    });

    it("recognizes a single-character cliName via both `--x` and `-x`", () => {
      // Runtime's `parseArgv` accepts a 1-char cliName from BOTH the
      // long form (`--x value`) and the short form (`-x value`) without
      // requiring an explicit alias, because the aliasMap lookup for a
      // short option falls through to the canonical name. The
      // completion parser must mirror that or the cursor classification
      // for `-x <TAB>` falls through to a positional / subcommand case
      // instead of an option-value one.
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          x: arg(z.string(), { completion: { custom: { choices: ["hello"] } } }),
        }),
        run: () => {},
      });
      const longCtx = parseCompletionContext(["--x", ""], cmd);
      expect(longCtx.completionType).toBe("option-value");
      expect(longCtx.targetOption?.name).toBe("x");

      const shortCtx = parseCompletionContext(["-x", ""], cmd);
      expect(shortCtx.completionType).toBe("option-value");
      expect(shortCtx.targetOption?.name).toBe("x");
    });

    it("does not flip a boolean for a short-form `-n` against a long-only custom negation `n`", () => {
      // Runtime only accepts custom negation names in long form (`--n`),
      // never via the short token `-n`. The form-aware matching keeps
      // those token spaces separate so a stray `-n` is not misread as
      // the explicit negation.
      const cmd = defineCommand({
        name: "negshortform",
        args: z.object({
          cache: arg(z.boolean().default(true), { negation: "n" }),
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      const ctx = parseCompletionContext(["-n", "--field", ""], cmd);
      expect(ctx.parsedArgs.cache).toBeUndefined();
    });

    it("records a single-character custom negation as `false`", () => {
      // Runtime accepts a 1-char `negation: "n"` as `--n`, but the
      // explicit-match helper used to early-return on a 1-char input
      // before reaching the negation comparison, so `parsedArgs.cache`
      // stayed undefined.
      const cmd = defineCommand({
        name: "negshort",
        args: z.object({
          cache: arg(z.boolean().default(true), { negation: "n" }),
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      const ctx = parseCompletionContext(["--n", "--field", ""], cmd);
      expect(ctx.parsedArgs.cache).toBe(false);
    });

    it("does not record an implicit negation when a custom-string negation is set", () => {
      const cmd = defineCommand({
        name: "negcustom",
        args: z.object({
          cache: arg(z.boolean().default(true), { negation: "disable-cache" }),
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      // Default `--no-cache` must be ignored; only the custom name flips.
      const ctxImplicit = parseCompletionContext(["--no-cache", "--field", ""], cmd);
      expect(ctxImplicit.parsedArgs.cache).toBeUndefined();

      const ctxCustom = parseCompletionContext(["--disable-cache", "--field", ""], cmd);
      expect(ctxCustom.parsedArgs.cache).toBe(false);
    });

    it("preserves an inherited global array value when the subcommand does not redeclare it", () => {
      // The runtime parser shallow-merges `rawGlobalArgs`: the parent
      // frame's `--tag a` survives into the child unless the child
      // redeclares `--tag`. Completion must mirror that — clobbering on
      // descent would hide the parent's value from the resolver.
      const cmd = defineCommand({
        name: "mycli",
        subCommands: {
          sub: defineCommand({
            name: "sub",
            args: z.object({
              field: arg(z.string().optional(), {
                completion: { custom: { resolve: () => ({ candidates: [] }) } },
              }),
            }),
            run: () => {},
          }),
        },
      });
      const globals = z.object({ tag: arg(z.array(z.string()).default([])) });
      const ctx = parseCompletionContext(["--tag", "a", "sub", "--field", ""], cmd, globals);
      expect(ctx.parsedArgs.tag).toEqual(["a"]);
    });

    it("resets global array values at subcommand boundaries to mirror runtime semantics", () => {
      // The runtime parser merges `rawGlobalArgs` per-level via shallow
      // spread, so each level's array global replaces the previous one's
      // value rather than accumulating. The completion parser must
      // match that — `cli --tag a sub --tag b --field <TAB>` should see
      // `parsedArgs.tag === ['b']` at the resolver, not `['a','b']`.
      const globalArrayCmd = defineCommand({
        name: "mycli",
        subCommands: {
          sub: defineCommand({
            name: "sub",
            args: z.object({
              field: arg(z.string().optional(), {
                completion: { custom: { resolve: () => ({ candidates: [] }) } },
              }),
            }),
            run: () => {},
          }),
        },
      });
      const globals = z.object({ tag: arg(z.array(z.string()).default([])) });
      const ctx = parseCompletionContext(
        ["--tag", "a", "sub", "--tag", "b", "--field", ""],
        globalArrayCmd,
        globals,
      );
      expect(ctx.parsedArgs.tag).toEqual(["b"]);
    });

    it("prefers an explicit field named `noFoo` over implicit `foo` negation", () => {
      const cmd = defineCommand({
        name: "shadowcli",
        args: z.object({
          foo: arg(z.boolean().default(false)),
          noFoo: arg(z.string().optional()),
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      // `--no-foo bar` must populate `noFoo`, not flip `foo`.
      const ctx = parseCompletionContext(["--no-foo", "bar", "--field", ""], cmd);
      expect(ctx.parsedArgs.foo).toBeUndefined();
      expect(ctx.parsedArgs.noFoo).toBe("bar");
    });

    it("does not record the default `--no-<flag>` negation without opt-in", () => {
      const implicitCmd = defineCommand({
        name: "implicitcli",
        args: z.object({
          cache: arg(z.boolean().default(true)),
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      const ctxHyphen = parseCompletionContext(["--no-cache", "--field", ""], implicitCmd);
      expect(ctxHyphen.parsedArgs.cache).toBeUndefined();

      const ctxCamel = parseCompletionContext(["--noCache", "--field", ""], implicitCmd);
      expect(ctxCamel.parsedArgs.cache).toBeUndefined();
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

    it("does not descend into Object.prototype-inherited names as subcommands", () => {
      // A bare `command.subCommands[name]` lookup resolves `__proto__`,
      // `constructor`, etc. through the prototype chain as soon as
      // `subCommands` is a defined object — even an empty one — so this
      // doesn't depend on any subcommand actually being registered,
      // corrupting completion context by "descending" into
      // `Object.prototype`.
      const parent = defineCommand({
        name: "mycli",
        args: z.object({ endpoint: arg(z.string().optional(), { positional: true }) }),
        subCommands: {},
      });
      const ctx = parseCompletionContext(["__proto__"], parent);
      expect(ctx.subcommandPath).toEqual([]);
      expect(ctx.currentCommand).toBe(parent);
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
      // The repeatable field being completed must NOT appear in
      // `parsedArgs` — `previousValues` is the contracted home for its
      // already-typed values, and exposing them under both would let a
      // resolver mistake the in-flight field for a sibling.
      expect(captured?.parsedArgs.field).toBeUndefined();
    });

    it("hides a variadic positional's previous values from parsedArgs", async () => {
      let captured: DynamicCompletionContext | undefined;
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          items: arg(z.array(z.string()).default([]), {
            positional: true,
            variadic: true,
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

      const ctx = parseCompletionContext(["alpha", "beta", ""], cmd);
      await generateCandidates(ctx, { shell: "bash" });
      expect(captured?.previousValues).toEqual(["alpha", "beta"]);
      expect(captured?.parsedArgs.items).toBeUndefined();
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

    it("collapses key=value resolver candidates to unique key= when no `=` typed yet", async () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                resolve: () => ({
                  candidates: ["first=NEXT", "first=PREV", "second=A", "second=B", "plain"],
                }),
              },
            },
          }),
        }),
        run: () => {},
      });

      const ctx = parseCompletionContext(["--field", ""], cmd);
      const result = await generateCandidates(ctx, { shell: "bash" });
      expect(result.candidates.map((c) => c.value)).toEqual(["first=", "second=", "plain"]);
      expect(result.directive & CompletionDirective.NoSpace).toBeTruthy();
    });

    it("keeps full key=value resolver candidates once the user types `=`", async () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                resolve: () => ({
                  candidates: ["first=NEXT", "first=PREV", "second=A"],
                }),
              },
            },
          }),
        }),
        run: () => {},
      });

      const ctx = parseCompletionContext(["--field", "first="], cmd);
      const result = await generateCandidates(ctx, { shell: "bash" });
      expect(result.candidates.map((c) => c.value)).toEqual([
        "first=NEXT",
        "first=PREV",
        "second=A",
      ]);
      // None of the candidates end with `=`, so NoSpace must not be forced.
      expect(result.directive & CompletionDirective.NoSpace).toBeFalsy();
    });

    it("sets NoSpace when resolver candidates already end with `=`", async () => {
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                resolve: () => ({ candidates: ["workspaceId=", "applicationName="] }),
              },
            },
          }),
        }),
        run: () => {},
      });

      const ctx = parseCompletionContext(["--field", ""], cmd);
      const result = await generateCandidates(ctx, { shell: "bash" });
      expect(result.candidates.map((c) => c.value)).toEqual(["workspaceId=", "applicationName="]);
      expect(result.directive & CompletionDirective.NoSpace).toBeTruthy();
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

      await runComplete(cmd, ["--field=foo"]);

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

      const lines = await runComplete(cmd, ["GetApplication", "-f", "workspaceId", "-f", ""]);
      expect(lines).toContain("applicationName");
      expect(lines).not.toContain("workspaceId");
      // Trailing directive line
      expect(lines.at(-1)).toMatch(/^:\d+$/);
    });

    it("returns resolver candidates even when required global args are missing", async () => {
      // Shell scripts call `__complete` from inside any partial command
      // line; the user has often not typed required globals yet. The
      // runner must skip global validation for `__complete` so the
      // completion fires regardless of those missing values.
      const cmd = withCompletionCommand(
        defineCommand({
          name: "mycli",
          args: z.object({
            field: arg(z.string().optional(), {
              completion: {
                custom: { resolve: () => ({ candidates: ["alpha", "beta"] }) },
              },
            }),
          }),
          run: () => {},
        }),
        {
          // `profile` is required but the completion invocation does not
          // supply it — the resolver must still run.
          globalArgsSchema: z.object({
            profile: arg(z.string()),
          }),
        },
      );

      const lines = await runComplete(cmd, ["--field", ""]);
      expect(lines).toContain("alpha");
      expect(lines).toContain("beta");
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
      const dyn = generateCompletion(dynamicCmd, {
        shell: "bash",
        programName: "mycli",
        mode: "static",
      }).script;
      const stat = generateCompletion(staticCmd, {
        shell: "bash",
        programName: "mycli",
        mode: "static",
      }).script;

      expect(dyn).toContain("__mycli_invoke_complete");
      expect(dyn).toContain("__mycli_apply_dynamic_output");
      expect(stat).not.toContain("__mycli_invoke_complete");
      // Bash 3.2 compatibility: the dynamic dispatch path also avoids
      // bash 4+ builtins so the script can be sourced on macOS's
      // default /bin/bash.
      expect(dyn).not.toMatch(/\bmapfile\b/);
      expect(dyn).not.toMatch(/\breadarray\b/);
    });

    it("zsh: emits apply helper only when dynamic specs exist", () => {
      const dyn = generateCompletion(dynamicCmd, {
        shell: "zsh",
        programName: "mycli",
        mode: "static",
      }).script;
      const stat = generateCompletion(staticCmd, {
        shell: "zsh",
        programName: "mycli",
        mode: "static",
      }).script;

      expect(dyn).toContain("__mycli_invoke_complete");
      expect(dyn).toContain("__mycli_apply_dynamic_output");
      expect(stat).not.toContain("__mycli_invoke_complete");
    });

    it("fish: emits apply helper only when dynamic specs exist", () => {
      const dyn = generateCompletion(dynamicCmd, {
        shell: "fish",
        programName: "mycli",
        mode: "static",
      }).script;
      const stat = generateCompletion(staticCmd, {
        shell: "fish",
        programName: "mycli",
        mode: "static",
      }).script;

      expect(dyn).toContain("__mycli_invoke_complete");
      expect(dyn).toContain("__mycli_apply_dynamic_output");
      expect(stat).not.toContain("__mycli_invoke_complete");
    });

    it("prefixes filesystem fallback candidates with the inline `--opt=` prefix", () => {
      // When `--path=<TAB>` triggers a resolver that also returns
      // FileCompletion, the appended filesystem matches must carry the
      // `--path=` prefix the resolver candidates already have —
      // otherwise accepting a file match drops the option name.
      const dyn = generateCompletion(dynamicCmd, {
        shell: "bash",
        programName: "mycli",
        mode: "static",
      }).script;
      expect(dyn).toContain(`local _ip="\${_inline_prefix:-}"`);
      expect(dyn).toContain(`COMPREPLY+=("\${_ip}\${_d}")`);
      expect(dyn).toContain(`COMPREPLY+=("\${_ip}\${_f}")`);
    });

    it("supports MYCLI_BIN override in bash script", () => {
      const dyn = generateCompletion(dynamicCmd, {
        shell: "bash",
        programName: "mycli",
        mode: "static",
      }).script;
      expect(dyn).toContain("${MYCLI_BIN:-mycli}");
    });

    it("prefixes a leading-digit programName so the BIN env var is a valid shell name", () => {
      const cmdDigit = defineCommand({
        name: "2fa",
        args: z.object({
          field: arg(z.string().optional(), {
            completion: { custom: { resolve: () => ({ candidates: [] }) } },
          }),
        }),
        run: () => {},
      });
      const bash = generateCompletion(cmdDigit, {
        shell: "bash",
        programName: "2fa",
        mode: "static",
      }).script;
      // bash/zsh forbid digit-leading parameter names; the override env
      // var must therefore be `_2FA_BIN`, not `2FA_BIN`.
      expect(bash).toContain("${_2FA_BIN:-2fa}");
      expect(bash).not.toContain("${2FA_BIN:-");
      const zsh = generateCompletion(cmdDigit, {
        shell: "zsh",
        programName: "2fa",
        mode: "static",
      }).script;
      expect(zsh).toContain("${_2FA_BIN:-2fa}");
      const fish = generateCompletion(cmdDigit, {
        shell: "fish",
        programName: "2fa",
        mode: "static",
      }).script;
      expect(fish).toContain("set -q _2FA_BIN");
    });

    it("bash: applies resolver-supplied directive bits via compopt", () => {
      const dyn = generateCompletion(dynamicCmd, {
        shell: "bash",
        programName: "mycli",
        mode: "static",
      }).script;
      // DirectoryCompletion=32, FileCompletion=16, NoSpace=1
      expect(dyn).toContain("(( _directive & 32 ))");
      // DirectoryCompletion populates COMPREPLY manually via `compgen -d`
      // (bash 3.2 lacks `compopt -o dirnames`).
      expect(dyn).toMatch(/compgen -d -- "\$_cur"/);
      expect(dyn).toContain("(( _directive & 16 ))");
      expect(dyn).toContain("compopt -o default");
      expect(dyn).toContain("(( _directive & 1 ))");
      expect(dyn).toContain("compopt -o nospace");
      // DirectoryCompletion must also strip the script-level `-o default`
      // fallback so file completion does not pollute a dir-only directive.
      expect(dyn).toMatch(
        /\(\( _directive & 32 \)\); then\s*\n\s*compopt \+o default[\s\S]*?compgen -d/,
      );
    });

    it("zsh: dispatches resolver directive bits to _files", () => {
      const dyn = generateCompletion(dynamicCmd, {
        shell: "zsh",
        programName: "mycli",
        mode: "static",
      }).script;
      expect(dyn).toContain("(( _directive & 32 ))");
      expect(dyn).toContain("_files -/");
      expect(dyn).toContain("(( _directive & 16 ))");
      expect(dyn).toContain("_files");
    });

    it("zsh emits resolver candidates alongside file directives instead of skipping them", () => {
      // When the resolver returns both candidates and FileCompletion /
      // DirectoryCompletion, zsh must surface the candidates first and
      // then layer `_files` on top, the same way bash/fish do.
      const zsh = generateCompletion(dynamicCmd, {
        shell: "zsh",
        programName: "mycli",
        mode: "static",
      }).script;
      // Candidates are pushed via __cdescribe before the directive block
      // handles `_files`. The new layout uses `elif` to chain directory →
      // file without `return`-ing early.
      expect(zsh).toMatch(
        /__mycli_cdescribe 'completions' _vals[\s\S]*?if \(\( _directive & 32 \)\); then[\s\S]*?_files -\/[\s\S]*?elif \(\( _directive & 16 \)\); then[\s\S]*?_files\n\s*fi/,
      );
    });

    it("does not filter resolver candidates that look like file-completion sentinels", () => {
      // `@ext:` and `@matcher:` are markers from the shellCommand pipeline
      // — they cannot appear from a dynamic resolver's perspective, so the
      // delegate apply helper must not drop them. Otherwise a resolver
      // returning a candidate literally named `@ext:tsx` would disappear.
      const bash = generateCompletion(dynamicCmd, {
        shell: "bash",
        programName: "mycli",
        mode: "static",
      }).script;
      expect(bash).not.toContain(`"@ext:"*|"@matcher:"*`);
      const zsh = generateCompletion(dynamicCmd, {
        shell: "zsh",
        programName: "mycli",
        mode: "static",
      }).script;
      expect(zsh).not.toContain("@ext:*|@matcher:*");
      const fish = generateCompletion(dynamicCmd, {
        shell: "fish",
        programName: "mycli",
        mode: "static",
      }).script;
      expect(fish).not.toContain("'@ext:*' '@matcher:*'");
    });

    it("zsh: invokes __complete with words sliced to CURRENT", () => {
      // Passing the whole `words` array would leak tokens typed after the
      // cursor into the resolver context. The delegate must slice via
      // `${(@)words[2,CURRENT]}` so `parseCompletionContext` sees only
      // the prefix up to the position being completed.
      const dyn = generateCompletion(dynamicCmd, {
        shell: "zsh",
        programName: "mycli",
        mode: "static",
      }).script;
      expect(dyn).toContain("${(@)words[2,CURRENT]}");
      expect(dyn).not.toContain("${words[@]:1}");
    });

    it("fish: dispatches resolver directive bits to __fish_complete_path", () => {
      const dyn = generateCompletion(dynamicCmd, {
        shell: "fish",
        programName: "mycli",
        mode: "static",
      }).script;
      // fish's `math` rejects the `&` operator with "Logical operations
      // are not supported"; the directive check must use the `bitand()`
      // function instead.
      expect(dyn).toContain(`math "bitand($_directive, 32)"`);
      expect(dyn).toContain("__fish_complete_directories");
      expect(dyn).toContain(`math "bitand($_directive, 16)"`);
      expect(dyn).toContain("__fish_complete_path");
      expect(dyn).not.toMatch(/math\s+"\$_directive\s*&/);
    });

    it("fish: re-emits resolver candidates via printf so `-n`-like values survive", () => {
      // fish's `echo` swallows leading `-n`/`-e`/`-s`/`-E`. The apply
      // helper buffers each line from `__complete` and re-emits it; the
      // re-emit must use `printf` so a resolver candidate equal to one
      // of those flags is not silently dropped.
      const dyn = generateCompletion(dynamicCmd, {
        shell: "fish",
        programName: "mycli",
        mode: "static",
      }).script;
      expect(dyn).toContain(`printf '%s\\n' "$_prev"`);
      expect(dyn).not.toMatch(/^\s*echo \$_prev$/m);
    });
  });

  describe("Variadic positional previousValues", () => {
    const cmd = defineCommand({
      name: "mycli",
      args: z.object({
        items: arg(z.array(z.string()).default([]), {
          positional: true,
          completion: {
            custom: { resolve: () => ({ candidates: [] }) },
          },
        }),
      }),
      run: () => {},
    });

    it("populates previousValues for repeated variadic positional values", () => {
      const ctx = parseCompletionContext(["foo", "bar", ""], cmd);
      expect(ctx.previousValues).toEqual(["foo", "bar"]);
    });

    it("returns empty previousValues at the first variadic position", () => {
      const ctx = parseCompletionContext([""], cmd);
      expect(ctx.previousValues).toEqual([]);
    });
  });

  describe("Global args resolver reachability", () => {
    const globalArgs = z.object({
      profile: arg(z.string().optional(), {
        description: "Profile name",
        completion: {
          custom: {
            resolve: () => ({ candidates: ["default", "staging", "prod"] }),
          },
        },
      }),
    });

    const sub = defineCommand({
      name: "deploy",
      args: z.object({
        env: arg(z.string()),
      }),
      run: () => {},
    });

    const root = withCompletionCommand(
      defineCommand({
        name: "mycli",
        subCommands: { deploy: sub },
      }),
      { globalArgsSchema: globalArgs },
    );

    it("forwards globalArgsSchema so global resolvers are reached from a subcommand", async () => {
      const lines = await runComplete(root, ["deploy", "--profile", ""]);
      expect(lines).toContain("default");
      expect(lines).toContain("staging");
      expect(lines).toContain("prod");
    });

    it("local options shadow same-named global options", () => {
      const localShadow = z.object({
        profile: arg(z.string(), {
          completion: { custom: { choices: ["local-only"] } },
        }),
      });
      const cmd = defineCommand({
        name: "mycli",
        args: localShadow,
        run: () => {},
      });
      const ctx = parseCompletionContext(["--profile", ""], cmd, globalArgs);
      // The local definition wins; targetOption resolves to local.
      expect(ctx.targetOption?.valueCompletion?.type).toBe("choices");
    });

    it("does not route a same-named local option's value to globalParsedArgs", () => {
      const subWithSameName = defineCommand({
        name: "deploy",
        args: z.object({
          // Local `profile` shadows the global one.
          profile: arg(z.string(), {
            completion: { custom: { choices: ["a", "b"] } },
          }),
        }),
        run: () => {},
      });
      const parent = defineCommand({
        name: "mycli",
        subCommands: { deploy: subWithSameName },
      });
      // Pass a value for the *local* `profile` after the subcommand. The local
      // declaration should win and the value should NOT survive a hypothetical
      // further descent (here we just verify it lands in parsedArgs by reading
      // it directly through the merged view).
      const ctx = parseCompletionContext(
        ["deploy", "--profile", "local-val", ""],
        parent,
        globalArgs,
      );
      expect(ctx.parsedArgs.profile).toBe("local-val");
    });

    it("preserves global option values across subcommand descent", () => {
      const subWithResolver = defineCommand({
        name: "deploy",
        args: z.object({
          env: arg(z.string(), {
            completion: {
              custom: {
                resolve: ({ parsedArgs }) => ({
                  candidates: parsedArgs.profile === "prod" ? ["live"] : [],
                }),
              },
            },
          }),
        }),
        run: () => {},
      });
      const parent = defineCommand({
        name: "mycli",
        subCommands: { deploy: subWithResolver },
      });
      const ctx = parseCompletionContext(
        ["--profile", "prod", "deploy", "--env", ""],
        parent,
        globalArgs,
      );
      // The global `profile` value supplied before the subcommand survives
      // the descent and is visible to the subcommand resolver.
      expect(ctx.parsedArgs.profile).toBe("prod");
    });

    it("skips suppressed global negations while pre-scanning globals before descent", () => {
      // Runtime's global scan skips a default `--no-*` negation when that
      // boolean did not opt in, then keeps scanning later global tokens.
      // Completion must do the same or a shadowing local boolean can overwrite
      // a later global scalar value during subcommand descent.
      const globals = z.object({
        cache: arg(z.boolean().default(true)),
        profile: arg(z.string().optional()),
      });
      const build = defineCommand({
        name: "build",
        args: z.object({
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      const parentWithShadow = defineCommand({
        name: "mycli",
        args: z.object({
          profile: arg(z.boolean().default(false)),
        }),
        subCommands: { build },
      });
      const ctx = parseCompletionContext(
        ["--no-cache", "--profile", "prod", "build", "--field", ""],
        parentWithShadow,
        globals,
      );
      expect(ctx.subcommandPath).toEqual(["build"]);
      expect(ctx.parsedArgs.profile).toBe("prod");
      expect(ctx.parsedArgs.cache).toBeUndefined();
    });

    it("migrates a parent's shadowed-global value into globals on descent", () => {
      // Runtime's `scanForSubcommand` only knows the global schema, so a
      // global-named flag placed at a parent frame that has a child is
      // harvested into globals — even when the parent redeclares the
      // flag locally. The parser must mirror this: the shadow keeps the
      // value local while we're still on the parent frame, but on
      // descent the value migrates to `globalParsedArgs` so the child's
      // resolver sees it.
      const child = defineCommand({
        name: "child",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                resolve: ({ parsedArgs }) => ({
                  candidates: parsedArgs.profile === "prod" ? ["live"] : ["dev"],
                }),
              },
            },
          }),
        }),
        run: () => {},
      });
      const parentWithShadow = defineCommand({
        name: "parent",
        args: z.object({
          // Local `profile` shadows the global at the parent frame.
          profile: arg(z.string().optional()),
        }),
        subCommands: { child },
      });
      const root = defineCommand({
        name: "mycli",
        subCommands: { parent: parentWithShadow },
      });
      const ctx = parseCompletionContext(
        ["parent", "--profile", "prod", "child", "--field", ""],
        root,
        globalArgs,
      );
      expect(ctx.parsedArgs.profile).toBe("prod");
    });

    it("migrates a token-colliding local value (different field name) into globals on descent", () => {
      // The parent declares a local option `localProfile` whose alias
      // `p` happens to share its CLI token (`-p`) with the global
      // `profile`'s alias. The completion parser's `findOption` resolves
      // `-p` to the local first, so the value lands in
      // `parsedArgs.localProfile`. Runtime's `scanForSubcommand` would
      // have routed `-p prod` to `globalArgs.profile` (it only knows the
      // global schema and harvests the matching token), so on descent
      // the value must migrate to `globalParsedArgs.profile`.
      const globals = z.object({
        profile: arg(z.string(), { alias: "p" }),
      });
      const child = defineCommand({
        name: "child",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                resolve: ({ parsedArgs }) => ({
                  candidates: parsedArgs.profile === "prod" ? ["live"] : ["dev"],
                }),
              },
            },
          }),
        }),
        run: () => {},
      });
      const parentWithAliasCollision = defineCommand({
        name: "parent",
        args: z.object({
          localProfile: arg(z.string().optional(), { alias: "p" }),
        }),
        subCommands: { child },
      });
      const root = defineCommand({
        name: "mycli",
        subCommands: { parent: parentWithAliasCollision },
      });
      const ctx = parseCompletionContext(
        ["parent", "-p", "prod", "child", "--field", ""],
        root,
        globals,
      );
      expect(ctx.parsedArgs.profile).toBe("prod");
    });

    it("resolves a global's non-colliding alias even when a local owns the cliName", () => {
      // Local cliName `env` (token `--env`) shadows the global only on
      // that exact token. The global's `-e` alias is not shadowed, so
      // `-e prod` must still surface as the global's value — runtime's
      // `separateGlobalArgs` keeps that token for the global. Previously
      // `mergeGlobalOptions` filtered the whole global out by cliName.
      const globals = z.object({
        env: arg(z.string().optional(), { alias: "e" }),
      });
      const cmd = defineCommand({
        name: "mycli",
        args: z.object({
          env: arg(z.string().optional()),
          field: arg(z.string().optional()),
        }),
        run: () => {},
      });
      const ctx = parseCompletionContext(["-e", "prod", "--field", ""], cmd, globals);
      expect(ctx.parsedArgs.env).toBe("prod");
    });

    it("takes the LAST element when migrating an array-typed local into a scalar global", () => {
      // Parent declares a local array `localProfiles` aliased `-p`; the
      // global `profile` is scalar with alias `-p`. Runtime's
      // `parseArgv` does last-wins for scalar globals, so the migrated
      // value the child resolver sees must be the trailing array
      // element, not the first.
      const globalsScalar = z.object({
        profile: arg(z.string().optional(), { alias: "p" }),
      });
      const child = defineCommand({
        name: "child",
        args: z.object({ field: arg(z.string().optional()) }),
        run: () => {},
      });
      const parent = defineCommand({
        name: "parent",
        args: z.object({
          localProfiles: arg(z.array(z.string()).default([]), { alias: "p" }),
        }),
        subCommands: { child },
      });
      const root = defineCommand({
        name: "mycli",
        subCommands: { parent },
      });
      const ctx = parseCompletionContext(
        ["parent", "-p", "dev", "-p", "prod", "child", "--field", ""],
        root,
        globalsScalar,
      );
      expect(ctx.parsedArgs.profile).toBe("prod");
    });

    it("wraps a scalar-typed local value into an array when migrating to an array-typed global", () => {
      // Token collision between a parent's local scalar (`title`, alias
      // `-t`) and a global array (`tags`, alias `-t`). The runtime
      // would treat `-t foo` as a single value appended to the global
      // array, so on descent the migrated value must arrive as `["foo"]`
      // rather than the raw scalar `"foo"`.
      const globalsArr = z.object({
        tags: arg(z.array(z.string()).default([]), { alias: "t" }),
      });
      const child = defineCommand({
        name: "child",
        args: z.object({ field: arg(z.string().optional()) }),
        run: () => {},
      });
      const parent = defineCommand({
        name: "parent",
        args: z.object({
          title: arg(z.string().optional(), { alias: "t" }),
        }),
        subCommands: { child },
      });
      const root = defineCommand({
        name: "mycli",
        subCommands: { parent },
      });
      const ctx = parseCompletionContext(
        ["parent", "-t", "foo", "child", "--field", ""],
        root,
        globalsArr,
      );
      expect(ctx.parsedArgs.tags).toEqual(["foo"]);
    });
  });

  describe("Candidate values starting with `:` survive the directive filter", () => {
    const cmd = withCompletionCommand(
      defineCommand({
        name: "mycli",
        args: z.object({
          field: arg(z.string(), {
            completion: {
              custom: {
                resolve: () => ({
                  candidates: [":pseudo", "::double", "regular"],
                }),
              },
            },
          }),
        }),
        run: () => {},
      }),
    );

    it("emits `:`-prefixed candidates rather than dropping them as directives", async () => {
      const lines = await runComplete(cmd, ["--field", ""]);
      expect(lines).toContain(":pseudo");
      expect(lines).toContain("::double");
      expect(lines).toContain("regular");
      // Final line must still be a `:<digits>` directive sentinel.
      expect(lines.at(-1)).toMatch(/^:\d+$/);
    });
  });

  describe("fish dynamic helper passes the typed token", () => {
    const dynamicCmd = defineCommand({
      name: "mycli",
      args: z.object({
        path: arg(z.string(), {
          completion: {
            custom: { resolve: () => ({ candidates: [] }) },
          },
        }),
      }),
      run: () => {},
    });

    it("fish: forwards $_cur to the apply helper", () => {
      const dyn = generateCompletion(dynamicCmd, { shell: "fish", programName: "mycli" }).script;
      expect(dyn).toContain(`__mycli_apply_dynamic_output "$_cur"`);
      expect(dyn).toContain(`__fish_complete_path "$_cur"`);
      expect(dyn).toContain(`__fish_complete_directories "$_cur"`);
    });
  });
});
