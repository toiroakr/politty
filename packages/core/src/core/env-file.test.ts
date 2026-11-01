import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { arg } from "./arg-registry.js";
import { defineCommand } from "./command.js";
import { runCommand, runMain } from "./runner.js";

const useArgv = (argv: string[]) => {
  const originalArgv = process.argv;
  process.argv = argv;
  return {
    [Symbol.dispose]() {
      process.argv = originalArgv;
    },
  };
};

const ENV_KEYS = ["TEST_EF_ORG", "TEST_EF_JSON", "TEST_EF_A", "TEST_EF_B"];

describe("envFile global option", () => {
  let dir: string;
  const write = (name: string, content: string): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "politty-env-file-"));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const globalArgs = z.object({
    envFile: arg(z.string().array().optional(), { alias: "e", envFile: true }),
    envFileIfExists: arg(z.string().array().optional(), { envFile: "if-exists" }),
    json: arg(z.boolean().default(false), { alias: "j", env: "TEST_EF_JSON" }),
  });

  const orgCommand = (run = vi.fn()) =>
    defineCommand({
      name: "get",
      args: z.object({ organizationId: arg(z.string(), { env: "TEST_EF_ORG" }) }),
      run,
    });

  it("fills a command option's env fallback from the env file given by -e", async () => {
    const run = vi.fn();
    const file = write("org.env", "TEST_EF_ORG=from-file\n");

    const result = await runCommand(orgCommand(run), ["-e", file], { globalArgs });

    expect(result.exitCode).toBe(0);
    expect(run.mock.calls[0]?.[0].organizationId).toBe("from-file");
  });

  it("fills a global option's env fallback from the env file", async () => {
    const run = vi.fn();
    const file = write("json.env", "TEST_EF_JSON=true\nTEST_EF_ORG=x\n");

    await runCommand(orgCommand(run), ["-e", file], { globalArgs });

    expect(run.mock.calls[0]?.[0].json).toBe(true);
  });

  it("does not read the env file when --help is requested, even if the file is missing", async () => {
    const result = await runCommand(orgCommand(), ["--help", "-e", path.join(dir, "missing.env")], {
      globalArgs,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    expect(result.exitCode).toBe(0);
  });

  it("does not read the env file when --version is requested, even if the file is missing", async () => {
    const result = await runCommand(
      orgCommand(),
      ["--version", "-e", path.join(dir, "missing.env")],
      {
        globalArgs,
        logger: { log: vi.fn(), error: vi.fn() },
      },
    );

    expect(result.exitCode).toBe(0);
  });

  it("fails with a usage error naming the resolved path when a required env file is missing", async () => {
    const missing = path.join(dir, "missing.env");

    const result = await runCommand(orgCommand(), ["-e", missing], { globalArgs });

    expect(result.exitCode).toBe(2);
    expect(result.success === false && result.error.message).toBe(
      `Environment file not found: ${missing}`,
    );
  });

  it("skips a missing env file given to an if-exists option", async () => {
    const run = vi.fn();
    process.env.TEST_EF_ORG = "from-env";

    const result = await runCommand(
      orgCommand(run),
      ["--env-file-if-exists", path.join(dir, "missing.env")],
      { globalArgs },
    );

    expect(result.exitCode).toBe(0);
    expect(run.mock.calls[0]?.[0].organizationId).toBe("from-env");
  });

  it("lets a later env file override an earlier one", async () => {
    const run = vi.fn();
    const first = write("1.env", "TEST_EF_ORG=first\n");
    const second = write("2.env", "TEST_EF_ORG=second\n");

    await runCommand(orgCommand(run), ["-e", first, "-e", second], { globalArgs });

    expect(run.mock.calls[0]?.[0].organizationId).toBe("second");
  });

  it("keeps a variable that was already set in the environment", async () => {
    const run = vi.fn();
    process.env.TEST_EF_ORG = "from-shell";
    const file = write("org.env", "TEST_EF_ORG=from-file\n");

    await runCommand(orgCommand(run), ["-e", file], { globalArgs });

    expect(run.mock.calls[0]?.[0].organizationId).toBe("from-shell");
  });

  it("reads the env file of a boolean flag bundle such as -je", async () => {
    const run = vi.fn();
    const file = write("org.env", "TEST_EF_ORG=from-bundle\n");

    await runCommand(orgCommand(run), ["-je", file], { globalArgs });

    expect(run.mock.calls[0]?.[0].organizationId).toBe("from-bundle");
    expect(run.mock.calls[0]?.[0].json).toBe(true);
  });

  it("loads env files given before and after the subcommand, outer first", async () => {
    const run = vi.fn();
    const outer = write("outer.env", "TEST_EF_ORG=outer\nTEST_EF_A=a\n");
    const inner = write("inner.env", "TEST_EF_ORG=inner\n");
    const root = defineCommand({ name: "root", subCommands: { get: orgCommand(run) } });

    await runCommand(root, ["-e", outer, "get", "-e", inner], { globalArgs });

    expect(run.mock.calls[0]?.[0].organizationId).toBe("inner");
    expect(process.env.TEST_EF_A).toBe("a");
  });

  it("loads the required option's files before the if-exists option's, whatever the argv order", async () => {
    const run = vi.fn();
    const required = write("required.env", "TEST_EF_ORG=required\n");
    const optional = write("optional.env", "TEST_EF_ORG=optional\n");

    await runCommand(orgCommand(run), ["--env-file-if-exists", optional, "-e", required], {
      globalArgs,
    });

    expect(run.mock.calls[0]?.[0].organizationId).toBe("optional");
  });

  it("leaves a missing env file to the plugin when a nested unknown subcommand is dispatched to one", async () => {
    using _argv = useArgv([
      "node",
      "root",
      "tailordb",
      "erd",
      "export",
      "-e",
      path.join(dir, "missing.env"),
    ]);
    using exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const onUnknownSubcommand = vi.fn().mockResolvedValue(0);
    const root = defineCommand({
      name: "root",
      subCommands: {
        tailordb: defineCommand({ name: "tailordb", subCommands: { ls: orgCommand() } }),
      },
    });

    await runMain(root, { globalArgs, onUnknownSubcommand });

    expect(onUnknownSubcommand).toHaveBeenCalledWith(expect.objectContaining({ name: "erd" }));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  describe("command groups", () => {
    const group = (run = vi.fn()) =>
      defineCommand({ name: "root", subCommands: { get: orgCommand(run) } });

    it("shows the group's help instead of failing on a missing env file when no subcommand is given", async () => {
      const log = vi.fn();

      const result = await runCommand(group(), ["-e", path.join(dir, "missing.env")], {
        globalArgs,
        logger: { log, error: vi.fn() },
      });

      expect(result.exitCode).toBe(0);
      expect(log).toHaveBeenCalled();
    });

    it("reports a mistyped subcommand instead of a missing env file", async () => {
      const result = await runCommand(group(), ["gett", "-e", path.join(dir, "missing.env")], {
        globalArgs,
        logger: { log: vi.fn(), error: vi.fn() },
      });

      expect(result.success === false && result.error.message).toMatch(/Unknown subcommand: gett/);
    });

    it("reads the env file for the default subcommand's leaf", async () => {
      const run = vi.fn();
      const file = write("org.env", "TEST_EF_ORG=from-default\n");
      const withDefault = defineCommand({
        name: "root",
        defaultSubCommand: "get",
        subCommands: { get: orgCommand(run) },
      });

      await runCommand(withDefault, ["-e", file], { globalArgs });

      expect(run.mock.calls[0]?.[0].organizationId).toBe("from-default");
    });
  });

  it("does not read a path given after --", async () => {
    const run = vi.fn();
    process.env.TEST_EF_ORG = "from-env";
    const file = write("org.env", "TEST_EF_ORG=from-file\n");
    const cmd = defineCommand({
      name: "get",
      args: z.object({
        rest: arg(z.string().array().optional(), { positional: true }),
        organizationId: arg(z.string(), { env: "TEST_EF_ORG" }),
      }),
      run,
    });

    await runCommand(cmd, ["--", "-e", file], { globalArgs });

    expect(run.mock.calls[0]?.[0].organizationId).toBe("from-env");
  });

  it("reads an env file given to a single-string option", async () => {
    const run = vi.fn();
    const file = write("org.env", "TEST_EF_ORG=from-string\n");

    await runCommand(orgCommand(run), ["-e", file], {
      globalArgs: z.object({ envFile: arg(z.string().optional(), { alias: "e", envFile: true }) }),
    });

    expect(run.mock.calls[0]?.[0].organizationId).toBe("from-string");
  });

  it("applies no variable of an earlier file when a later required file is missing", async () => {
    const first = write("1.env", "TEST_EF_A=leaked\n");

    const result = await runCommand(
      orgCommand(),
      ["-e", first, "-e", path.join(dir, "missing.env")],
      {
        globalArgs,
      },
    );

    expect(result.exitCode).toBe(2);
    expect(process.env.TEST_EF_A).toBeUndefined();
  });

  describe("definition", () => {
    const unionWith = (a: boolean | "if-exists", b: boolean | "if-exists") =>
      z.discriminatedUnion("mode", [
        z.object({
          mode: z.literal("a"),
          envFile: arg(z.string().array().optional(), { envFile: a }),
        }),
        z.object({
          mode: z.literal("b"),
          envFile: arg(z.string().array().optional(), { envFile: b }),
        }),
      ]);

    it("rejects envFile on an option whose value is not a string or an array of strings", async () => {
      const cmd = defineCommand({ name: "get", run: vi.fn() });

      await expect(
        runCommand(cmd, [], {
          globalArgs: z.object({ flag: arg(z.boolean().default(false), { envFile: true }) }),
        }),
      ).rejects.toThrow(
        'Global option "flag" sets envFile but its value is not a string or an array of strings',
      );
    });

    it("rejects a union whose variants declare the same option with different envFile settings", async () => {
      const cmd = defineCommand({ name: "get", run: vi.fn() });

      await expect(
        runCommand(cmd, ["--mode", "a"], { globalArgs: unionWith(true, "if-exists") }),
      ).rejects.toThrow(
        'Global option "envFile" has different envFile settings across union variants (true, "if-exists")',
      );
    });

    it("rejects conflicting envFile settings in a discriminated union nested inside a union", async () => {
      const cmd = defineCommand({ name: "get", run: vi.fn() });
      const nested = z.union([
        unionWith(true, "if-exists"),
        z.object({ other: arg(z.string().optional(), {}) }),
      ]);

      await expect(runCommand(cmd, [], { globalArgs: nested })).rejects.toThrow(
        'Global option "envFile" has different envFile settings across union variants',
      );
    });

    it("accepts a union whose variants declare the same envFile setting", async () => {
      const cmd = defineCommand({ name: "get", run: vi.fn() });

      const result = await runCommand(cmd, ["--mode", "a"], {
        globalArgs: unionWith("if-exists", "if-exists"),
      });

      expect(result.exitCode).toBe(0);
    });
  });

  it("hands the current level's globals to cleanup when a required env file is missing", async () => {
    const cleanup = vi.fn();

    await runCommand(orgCommand(), ["--json", "-e", path.join(dir, "missing.env")], {
      globalArgs,
      cleanup,
    });

    expect(cleanup.mock.calls[0]?.[0].globalArgs?.json).toBe(true);
  });

  it("reads the env file of an option declared in only one variant of a union", async () => {
    const run = vi.fn();
    const file = write("org.env", "TEST_EF_ORG=from-variant\n");
    const variants = z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("a") }),
      z.object({
        mode: z.literal("b"),
        envFile: arg(z.string().array().optional(), { alias: "e", envFile: true }),
      }),
    ]);

    await runCommand(orgCommand(run), ["--mode", "b", "-e", file], { globalArgs: variants });

    expect(run.mock.calls[0]?.[0].organizationId).toBe("from-variant");
  });

  it("reads the env file of an option declared in only one option of a plain union", async () => {
    const run = vi.fn();
    const file = write("org.env", "TEST_EF_ORG=from-union\n");
    const union = z.union([
      z.object({ other: arg(z.string(), {}) }),
      z.object({ envFile: arg(z.string().array().optional(), { alias: "e", envFile: true }) }),
    ]);

    await runCommand(orgCommand(run), ["-e", file], { globalArgs: union });

    expect(run.mock.calls[0]?.[0].organizationId).toBe("from-union");
  });

  it("reads the env file of an option in a discriminated union nested inside a union", async () => {
    const run = vi.fn();
    const file = write("org.env", "TEST_EF_ORG=from-nested\n");
    const nested = z.union([
      z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("a") }),
        z.object({
          mode: z.literal("b"),
          envFile: arg(z.string().array().optional(), { alias: "e", envFile: true }),
        }),
      ]),
      z.object({ other: arg(z.string(), {}) }),
    ]);

    await runCommand(orgCommand(run), ["--mode", "b", "-e", file], { globalArgs: nested });

    expect(run.mock.calls[0]?.[0].organizationId).toBe("from-nested");
  });
});
