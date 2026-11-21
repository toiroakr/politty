import { promptMissingArgs } from "@politty/core/prompt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createDefineCommand,
  defineCommand,
  runCommand,
  standardArgs,
  withCompletionCommand,
} from "./index.js";

describe("@politty/standard CLI", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("resolves aliases, environment values, and kebab-case arguments", async () => {
    vi.stubEnv("POLITTY_STANDARD_TEST_TARGET", "preview");
    const command = defineCommand({
      name: "deploy",
      args: standardArgs(z.object({ targetName: z.string() }), {
        fields: { targetName: { alias: "t", env: "POLITTY_STANDARD_TEST_TARGET" } },
      }),
      run: (args) => [args.targetName, args["target-name"], args.$source?.("targetName")],
    });
    expect((await runCommand(command, [])).result).toEqual(["preview", "preview", "env"]);
    expect((await runCommand(command, ["-t", "prod"])).result).toEqual(["prod", "prod", "cli"]);
    expect((await runCommand(command, ["--target-name", "local"])).result).toEqual([
      "local",
      "local",
      "cli",
    ]);
  });

  it("runs effects with validated values before the command and skips them on invalid input", async () => {
    const calls: string[] = [];
    const command = defineCommand({
      name: "build",
      args: standardArgs(
        z.object({ count: z.coerce.number().positive(), cache: z.boolean().default(true) }),
        {
          fields: {
            count: {
              effect: (value) => {
                calls.push(`effect:${value.toFixed(1)}`);
              },
            },
            cache: { negation: "skip-cache" },
          },
        },
      ),
      run: ({ count, cache }) => {
        calls.push(`run:${count}:${cache}`);
      },
    });
    expect(await runCommand(command, ["--count", "-1"])).toMatchObject({ success: false });
    expect(calls).toEqual([]);
    expect(await runCommand(command, ["--count", "3", "--skip-cache"])).toMatchObject({
      success: true,
    });
    expect(calls).toEqual(["effect:3.0", "run:3:false"]);
  });

  it("routes a subcommand with configured global arguments", async () => {
    const globalArgs = standardArgs(z.object({ verbose: z.boolean().default(false) }), {
      fields: { verbose: { alias: "v" } },
    });
    const child = createDefineCommand<{ verbose: boolean }>()({
      name: "show",
      args: standardArgs(z.object({ path: z.string() }), {
        fields: { path: { positional: true } },
      }),
      run: ({ path, verbose }) => ({ path, verbose }),
    });
    const command = defineCommand({ name: "project", subCommands: { show: child } });
    expect(await runCommand(command, ["-v", "show", "config.json"], { globalArgs })).toMatchObject({
      success: true,
      result: { path: "config.json", verbose: true },
    });
  });

  it("honors explicit unknown-option handling", async () => {
    const schema = z.looseObject({ name: z.string().default("world") });
    const strict = defineCommand({
      name: "greet",
      args: standardArgs(schema, { unknownKeys: "strict" }),
      run: ({ name }) => name,
    });
    const loose = defineCommand({
      name: "greet",
      args: standardArgs(schema, { unknownKeys: "passthrough" }),
      run: (args) => args.extra,
    });
    expect(await runCommand(strict, ["--extra", "value"])).toMatchObject({
      success: false,
      error: { message: "Unknown flags: extra" },
    });
    expect(await runCommand(loose, ["--extra", "value"], { captureLogs: true })).toMatchObject({
      success: true,
      result: "value",
      logs: { entries: [] },
    });
  });

  it("offers enum values to the prompt resolver and validates the answer", async () => {
    const select = vi.fn(async () => "prod");
    const unexpectedPrompt = async () => {
      throw new Error("Expected a select prompt");
    };
    const command = defineCommand({
      name: "deploy",
      args: standardArgs(z.object({ target: z.enum(["preview", "prod"]) }), {
        fields: { target: { prompt: { message: "Deployment target" } } },
      }),
      run: (args) => [args.target, args.$source?.("target")],
    });
    const result = await runCommand(command, [], {
      prompt: (args, fields) =>
        promptMissingArgs(args, fields, {
          interactive: true,
          adapter: {
            select,
            text: unexpectedPrompt,
            password: unexpectedPrompt,
            confirm: unexpectedPrompt,
            isCancelled: () => false,
          },
        }),
    });

    expect(result).toMatchObject({ success: true, result: ["prod", "prompt"] });
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Deployment target",
        options: [
          { value: "preview", label: "preview" },
          { value: "prod", label: "prod" },
        ],
      }),
    );
  });

  it("returns filtered value candidates through the runtime completion command", async () => {
    const command = withCompletionCommand(
      defineCommand({
        name: "deploy",
        args: z.object({ target: z.enum(["preview", "prod", "local"]) }),
        run: () => undefined,
      }),
    );
    using log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(
      await runCommand(command, ["__complete", "--shell", "bash", "--", "--target", "pr"]),
    ).toMatchObject({ success: true });
    const candidates = log.mock.calls
      .flatMap(([line]) => String(line).split("\n"))
      .filter((line) => line && !line.startsWith(":") && !line.startsWith("@"));
    expect(candidates).toEqual(["preview", "prod"]);
  });

  it("exposes CLI metadata through --help-json without executing the command", async () => {
    const run = vi.fn();
    const command = defineCommand({
      name: "deploy",
      args: standardArgs(z.object({ target: z.enum(["preview", "prod"]).default("preview") }), {
        fields: { target: { alias: "t", description: "Deployment target" } },
      }),
      run,
    });
    const result = await runCommand(command, ["--help-json"], { captureLogs: true });
    expect(result.success).toBe(true);
    const output = result.logs.entries.map(({ message }) => message).join("\n");
    expect(JSON.parse(output)).toMatchObject({
      options: [
        {
          name: "target",
          alias: ["t"],
          description: "Deployment target",
          required: false,
          defaultValue: "preview",
          enumValues: ["preview", "prod"],
        },
      ],
    });
    expect(run).not.toHaveBeenCalled();
  });
});
