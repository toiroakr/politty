/**
 * Parity tests for the politty features that consume extracted field
 * metadata beyond plain parsing: interactive prompts, shell completion,
 * skill generation, subcommand routing, and global args.
 *
 * `e2e.test.ts` covers parse/validate/help/docs; these are the remaining
 * surfaces that read `ResolvedFieldMeta` (prompt type/choices, completion
 * candidates, generated SKILL.md option tables), so a valibot-specific gap
 * in metadata extraction would show up here rather than in parsing.
 */

import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { extractCompletionData } from "./completion.js";
import { arg, defineCommand, extractFields, runCommand } from "./index.js";
import { promptMissingArgs, resolvePromptConfig, type PromptAdapter } from "./prompt.js";
import { withSkillCommand } from "./skill.js";

describe("@politty/valibot parity: interactive prompts", () => {
  it("derives prompt type and choices from a picklist field", () => {
    const schema = v.object({
      level: arg(v.picklist(["debug", "info", "warn"]), {
        description: "Log level",
        prompt: {},
      }),
      token: arg(v.string(), { prompt: { type: "password", message: "Enter API token" } }),
      plain: arg(v.optional(v.string()), {}),
    });

    const byName = new Map(extractFields(schema).fields.map((f) => [f.name, f]));

    const level = resolvePromptConfig(byName.get("level")!);
    // picklist must resolve to a select whose choices come from the schema,
    // not fall back to a free-text prompt.
    expect(level?.type).toBe("select");
    expect(level?.choices?.map((c) => (typeof c === "string" ? c : c.value))).toEqual([
      "debug",
      "info",
      "warn",
    ]);
    expect(level?.message).toBe("Log level");

    expect(resolvePromptConfig(byName.get("token")!)?.type).toBe("password");
    // No prompt metadata means the field is never prompted for.
    expect(resolvePromptConfig(byName.get("plain")!)).toBeNull();
  });

  it("prompts only for missing fields, using the type each valibot schema implies", async () => {
    const asked: Array<{ kind: string; message: string; options?: string[] }> = [];
    const adapter: PromptAdapter = {
      text: async ({ message }) => {
        asked.push({ kind: "text", message });
        return "from-text";
      },
      password: async ({ message }) => {
        asked.push({ kind: "password", message });
        return "from-password";
      },
      confirm: async ({ message }) => {
        asked.push({ kind: "confirm", message });
        return true;
      },
      select: async ({ message, options }) => {
        asked.push({ kind: "select", message, options: options.map((o) => o.value) });
        return options[0]!.value;
      },
      isCancelled: () => false,
    };

    const schema = v.object({
      name: arg(v.string(), { prompt: { message: "Your name" } }),
      level: arg(v.picklist(["debug", "info"]), { prompt: { message: "Level" } }),
      secret: arg(v.string(), { prompt: { type: "password", message: "Secret" } }),
      other: arg(v.optional(v.string(), "kept"), { prompt: { message: "Other" } }),
    });

    const filled = await promptMissingArgs({ other: "given" }, extractFields(schema), {
      adapter,
      interactive: true,
    });

    expect(filled["name"]).toBe("from-text");
    expect(filled["level"]).toBe("debug");
    expect(filled["secret"]).toBe("from-password");
    // `other` already had a value, so it must not be prompted for.
    expect(filled["other"]).toBe("given");

    expect(asked.map((a) => a.kind)).toEqual(["text", "select", "password"]);
    // The select's options come from the picklist values.
    expect(asked.find((a) => a.kind === "select")?.options).toEqual(["debug", "info"]);
  });

  it("resolves prompts end-to-end through runCommand", async () => {
    const cmd = defineCommand({
      name: "deploy",
      args: v.object({
        target: arg(v.picklist(["dev", "prod"]), { prompt: { message: "Target" } }),
      }),
      run: (args) => args.target,
    });

    const result = await runCommand(cmd, [], {
      prompt: async (rawArgs) => ({ ...rawArgs, target: "prod" }),
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe("prod");
  });
});

describe("@politty/valibot parity: shell completion", () => {
  it("extracts option names, enum candidates, and completion metadata", () => {
    const cmd = defineCommand({
      name: "build",
      args: v.object({
        input: arg(v.string(), {
          positional: true,
          completion: { type: "file", extensions: ["ts", "js"] },
        }),
        level: arg(v.optional(v.picklist(["debug", "info"]), "info"), { alias: "L" }),
        outDir: arg(v.optional(v.string()), { completion: { type: "directory" } }),
        cache: arg(v.optional(v.boolean(), true), { negation: true }),
      }),
      run: () => {},
    });

    const data = extractCompletionData(cmd, "build");
    const options = new Map(data.command.options.map((o) => [o.name, o]));

    // kebab-case CLI names and the negation form reach the completion data.
    expect(options.get("outDir")?.cliName).toBe("out-dir");
    expect(options.get("cache")?.negation).toBe("no-cache");
    expect(options.get("level")?.alias).toEqual(["L"]);

    // picklist values become completion choices, and completion metadata
    // (directory / file+extensions) survives extraction.
    expect(options.get("level")?.valueCompletion).toEqual({
      type: "choices",
      choices: ["debug", "info"],
    });
    expect(options.get("outDir")?.valueCompletion).toEqual({ type: "directory" });

    const input = data.command.positionals.find((p) => p.name === "input");
    expect(input?.valueCompletion).toMatchObject({ type: "file", extensions: ["ts", "js"] });
  });
});

describe("@politty/valibot parity: skill generation", () => {
  it("renders valibot args into the generated skill command's output", async () => {
    const cmd = withSkillCommand(
      defineCommand({
        name: "mycli",
        description: "CLI with skills",
        args: v.object({
          target: arg(v.pipe(v.string(), v.description("Deploy target")), { positional: true }),
        }),
        run: () => {},
      }),
      { sourceDir: "skills", package: "@example/mycli" },
    );

    // The skill command is mounted and the host command keeps its own args
    // (extracted through the valibot adapter), so the positional still shows
    // up in the usage line next to the injected `skills` subcommand.
    expect(cmd.subCommands?.["skills"]).toBeDefined();
    const help = await runCommand(cmd, ["--help"], { captureLogs: true });
    const out = help.logs.entries.map((e) => e.message).join("\n");
    expect(out).toContain("Usage: mycli [command] <target>");
    expect(out).toContain("skills");

    // The skills subcommand's own args are valibot-free internal descriptors,
    // so mounting it must not break help for the nested command either.
    const skillsHelp = await runCommand(cmd, ["skills", "--help"], { captureLogs: true });
    expect(skillsHelp.exitCode).toBe(0);
  });
});

describe("@politty/valibot parity: subcommands and global args", () => {
  it("routes nested subcommands and validates each level's valibot schema", async () => {
    const cmd = defineCommand({
      name: "db",
      subCommands: {
        migrate: defineCommand({
          name: "migrate",
          subCommands: {
            up: defineCommand({
              name: "up",
              args: v.object({
                steps: arg(v.optional(v.pipe(v.unknown(), v.transform(Number), v.number()), 1), {
                  alias: "n",
                }),
              }),
              run: (args) => `up:${args.steps}`,
            }),
          },
        }),
      },
    });

    expect((await runCommand(cmd, ["migrate", "up", "-n", "3"])).result).toBe("up:3");
    expect((await runCommand(cmd, ["migrate", "up"])).result).toBe("up:1");

    // A value the nested schema rejects must fail, not fall through.
    const bad = await runCommand(cmd, ["migrate", "up", "-n", "abc"]);
    expect(bad.success).toBe(false);
  });

  it("merges a valibot globalArgs schema into command args", async () => {
    const cmd = defineCommand({
      name: "app",
      args: v.object({ local: arg(v.optional(v.string(), "l"), {}) }),
      run: (args) => `${args.local}:${(args as Record<string, unknown>)["verbose"]}`,
    });

    const result = await runCommand(cmd, ["--verbose"], {
      globalArgs: v.object({ verbose: arg(v.optional(v.boolean(), false), {}) }),
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe("l:true");
  });
});
