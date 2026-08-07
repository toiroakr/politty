/**
 * End-to-end parity tests: politty behavior driven entirely by valibot
 * schemas through the real `@politty/valibot` entry (adapter registered by
 * the module import, exactly like a user's CLI).
 *
 * The unit-project setup file registers the zod adapter for core tests;
 * importing `./index.js` here re-registers the valibot adapter for this
 * test file's module graph (vitest isolates module state per file).
 */

import * as v from "valibot";
import { afterEach, describe, expect, it } from "vitest";

import { renderArgsTable } from "./docs.js";
import { arg, defineCommand, runCommand } from "./index.js";

describe("@politty/valibot e2e", () => {
  it("should parse positionals, aliases, defaults, and coerced numbers", async () => {
    const cmd = defineCommand({
      name: "greet",
      args: v.object({
        name: arg(v.string(), { positional: true }),
        loud: arg(v.optional(v.boolean(), false), { alias: "l" }),
        times: arg(v.optional(v.pipe(v.unknown(), v.transform(Number), v.integer()), 1), {
          alias: "t",
        }),
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
      args: v.object({
        cache: arg(v.optional(v.boolean(), true), { negation: true }),
        color: arg(v.optional(v.boolean(), true), { negation: "plain" }),
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
      args: v.object({
        file: arg(v.array(v.string()), { alias: "f" }),
      }),
      run: (args) => args.file.join(","),
    });

    const result = await runCommand(cmd, ["-f", "a.ts", "-f", "b.ts"]);
    expect(result.result).toBe("a.ts,b.ts");
  });

  describe("env fallback", () => {
    afterEach(() => {
      delete process.env["POLITTY_VALIBOT_E2E_TOKEN"];
    });

    it("should fall back to environment variables and report $source", async () => {
      process.env["POLITTY_VALIBOT_E2E_TOKEN"] = "from-env";
      const cmd = defineCommand({
        name: "deploy",
        args: v.object({
          token: arg(v.string(), { env: "POLITTY_VALIBOT_E2E_TOKEN" }),
        }),
        run: (args) => `${args.token}:${args.$source?.("token")}`,
      });

      expect((await runCommand(cmd, [])).result).toBe("from-env:env");
      expect((await runCommand(cmd, ["--token", "cli"])).result).toBe("cli:cli");
    });
  });

  it("should route variant args by discriminator", async () => {
    const cmd = defineCommand({
      name: "resource",
      args: v.variant("action", [
        v.object({
          action: v.literal("create"),
          name: arg(v.string(), {}),
        }),
        v.object({
          action: v.literal("delete"),
          id: arg(v.pipe(v.unknown(), v.transform(Number), v.number()), {}),
        }),
      ]),
      run: (args) => (args.action === "create" ? `create:${args.name}` : `delete:${args.id}`),
    });

    expect((await runCommand(cmd, ["--action", "create", "--name", "x"])).result).toBe("create:x");
    expect((await runCommand(cmd, ["--action", "delete", "--id", "7"])).result).toBe("delete:7");
  });

  it("should fail with valibot's rich validation errors", async () => {
    const cmd = defineCommand({
      name: "serve",
      args: v.object({
        level: arg(v.picklist(["debug", "info"]), {}),
      }),
      run: () => "ok",
    });

    const result = await runCommand(cmd, ["--level", "nope"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Expected ("debug" | "info")');
    expect(result.error?.message).toContain('"nope"');
  });

  it("should reject unknown options for strictObject args", async () => {
    const cmd = defineCommand({
      name: "strict",
      args: v.strictObject({ name: v.optional(v.string(), "x") }),
      run: (args) => args.name,
    });

    const result = await runCommand(cmd, ["--unknown", "1"]);
    expect(result.success).toBe(false);
  });

  it("should run arg() effect callbacks after validation", async () => {
    const seen: unknown[] = [];
    const cmd = defineCommand({
      name: "fx",
      args: v.object({
        verbose: arg(v.optional(v.boolean(), false), {
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
      args: v.object({
        dryRun: arg(v.optional(v.boolean(), false), {}),
      }),
      run: (args) => `${args.dryRun}:${args["dry-run"]}`,
    });

    expect((await runCommand(cmd, ["--dry-run"])).result).toBe("true:true");
  });

  it("should render help from valibot schema metadata", async () => {
    const cmd = defineCommand({
      name: "help-demo",
      description: "Demo command",
      args: v.object({
        input: arg(v.pipe(v.string(), v.description("Input file")), {
          positional: true,
        }),
        level: arg(v.optional(v.picklist(["debug", "info"]), "info"), { alias: "L" }),
      }),
      run: () => "ok",
    });

    const result = await runCommand(cmd, ["--help"], { captureLogs: true });
    const help = result.logs.entries.map((e) => e.message).join("\n");
    expect(help).toContain("Usage: help-demo [options] <input>");
    expect(help).toContain("-L, --level <LEVEL>");
    expect(help).toContain('(default: "info")');
  });

  it("should render docs args tables from a valibot args shape", () => {
    const table = renderArgsTable({
      envFile: arg(v.optional(v.string()), {
        alias: "e",
        description: "Path to environment file",
      }),
    });
    expect(table).toContain("`--env-file <ENV_FILE>`");
    expect(table).toContain("`-e`");
    expect(table).toContain("Path to environment file");
  });
});
