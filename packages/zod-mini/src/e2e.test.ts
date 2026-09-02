/**
 * End-to-end parity tests: politty behavior driven entirely by zod/mini
 * schemas through the real `@politty/zod-mini` entry (adapter registered by
 * the module import, exactly like a user's CLI).
 *
 * The unit-project setup file registers the classic zod adapter for core
 * tests; importing `./index.js` here re-registers the zod/mini adapter for
 * this test file's module graph (vitest isolates module state per file).
 */

import { afterEach, describe, expect, it } from "vitest";
import * as z from "zod/mini";

import { renderArgsTable } from "./docs.js";
import { arg, defineCommand, runCommand } from "./index.js";

describe("@politty/zod-mini e2e", () => {
  it("should parse positionals, aliases, defaults, and coerced numbers", async () => {
    const cmd = defineCommand({
      name: "greet",
      args: z.object({
        name: arg(z.string(), { positional: true }),
        loud: arg(z._default(z.boolean(), false), { alias: "l" }),
        times: arg(z._default(z.coerce.number(), 1), { alias: "t" }),
      }),
      run: (args) => `${args.loud ? "LOUD" : "quiet"}:${args.name}:${args.times}`,
    });

    const result = await runCommand(cmd, ["World", "-l", "-t", "3"]);
    expect(result.success).toBe(true);
    expect(result.result).toBe("LOUD:World:3");

    const defaults = await runCommand(cmd, ["World"]);
    expect(defaults.result).toBe("quiet:World:1");
  });

  it("should support boolean negation (default --no-x and custom names)", async () => {
    const cmd = defineCommand({
      name: "build",
      args: z.object({
        cache: arg(z._default(z.boolean(), true), { negation: true }),
        color: arg(z._default(z.boolean(), true), { negation: "plain" }),
      }),
      run: (args) => `${args.cache}:${args.color}`,
    });

    expect((await runCommand(cmd, ["--no-cache"])).result).toBe("false:true");
    expect((await runCommand(cmd, ["--plain"])).result).toBe("true:false");
    // Custom negation replaces the default --no-* form: --no-color is now an
    // unknown option (warned and stripped in default strip mode), so color
    // keeps its default instead of being negated.
    const noColor = await runCommand(cmd, ["--no-color"]);
    expect(noColor.result).toBe("true:true");
  });

  it("should collect repeated flags into arrays", async () => {
    const cmd = defineCommand({
      name: "lint",
      args: z.object({
        file: arg(z.array(z.string()), { alias: "f" }),
      }),
      run: (args) => args.file.join(","),
    });

    const result = await runCommand(cmd, ["-f", "a.ts", "-f", "b.ts"]);
    expect(result.result).toBe("a.ts,b.ts");
  });

  describe("env fallback", () => {
    afterEach(() => {
      delete process.env["POLITTY_ZOD_MINI_E2E_TOKEN"];
    });

    it("should fall back to environment variables and report $source", async () => {
      process.env["POLITTY_ZOD_MINI_E2E_TOKEN"] = "from-env";
      const cmd = defineCommand({
        name: "deploy",
        args: z.object({
          token: arg(z.string(), { env: "POLITTY_ZOD_MINI_E2E_TOKEN" }),
        }),
        run: (args) => `${args.token}:${args.$source?.("token")}`,
      });

      expect((await runCommand(cmd, [])).result).toBe("from-env:env");
      expect((await runCommand(cmd, ["--token", "cli"])).result).toBe("cli:cli");
    });
  });

  it("should route discriminated union args by discriminator", async () => {
    const cmd = defineCommand({
      name: "resource",
      args: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("create"),
          name: arg(z.string(), {}),
        }),
        z.object({
          action: z.literal("delete"),
          id: arg(z.coerce.number(), {}),
        }),
      ]),
      run: (args) => (args.action === "create" ? `create:${args.name}` : `delete:${args.id}`),
    });

    expect((await runCommand(cmd, ["--action", "create", "--name", "x"])).result).toBe("create:x");
    expect((await runCommand(cmd, ["--action", "delete", "--id", "7"])).result).toBe("delete:7");
  });

  it("should fail with zod's rich validation errors", async () => {
    const cmd = defineCommand({
      name: "serve",
      args: z.object({
        level: arg(z.enum(["debug", "info"]), {}),
      }),
      run: () => "ok",
    });

    const result = await runCommand(cmd, ["--level", "nope"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("level");
  });

  it("should reject unknown options for strictObject args", async () => {
    const cmd = defineCommand({
      name: "strict",
      args: z.strictObject({ name: z._default(z.string(), "x") }),
      run: (args) => args.name,
    });

    const result = await runCommand(cmd, ["--unknown", "1"]);
    expect(result.success).toBe(false);
  });

  it("should run arg() effect callbacks after validation", async () => {
    const seen: unknown[] = [];
    const cmd = defineCommand({
      name: "fx",
      args: z.object({
        verbose: arg(z._default(z.boolean(), false), {
          effect: (value) => {
            seen.push(value);
          },
        }),
      }),
      run: (args) => args.verbose,
    });

    await runCommand(cmd, ["--verbose"]);
    expect(seen).toEqual([true]);
  });

  it("should expose dual-case access for kebab-case options", async () => {
    const cmd = defineCommand({
      name: "case",
      args: z.object({
        dryRun: arg(z._default(z.boolean(), false), {}),
      }),
      run: (args) => `${args.dryRun}:${args["dry-run"]}`,
    });

    expect((await runCommand(cmd, ["--dry-run"])).result).toBe("true:true");
  });

  it("should render help from zod/mini schema metadata", async () => {
    const input = z.string();
    z.globalRegistry.add(input, { description: "Input file" });

    const cmd = defineCommand({
      name: "help-demo",
      description: "Demo command",
      args: z.object({
        input: arg(input, { positional: true }),
        level: arg(z._default(z.enum(["debug", "info"]), "info"), { alias: "L" }),
      }),
      run: () => "ok",
    });

    const result = await runCommand(cmd, ["--help"], { captureLogs: true });
    const help = result.logs.entries.map((e) => e.message).join("\n");
    expect(help).toContain("Usage: help-demo [options] <input>");
    expect(help).toContain("-L, --level <LEVEL>");
    expect(help).toContain('(default: "info")');
  });

  it("should render docs args tables from a zod/mini args shape", () => {
    const table = renderArgsTable({
      envFile: arg(z.optional(z.string()), {
        alias: "e",
        description: "Path to environment file",
      }),
    });
    expect(table).toContain("`--env-file <ENV_FILE>`");
    expect(table).toContain("`-e`");
    expect(table).toContain("Path to environment file");
  });
});
