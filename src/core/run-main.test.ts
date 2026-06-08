import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { spyOnConsoleError, spyOnConsoleLog } from "../../tests/utils/console.js";
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

/**
 * Task 8.1: runCommand function tests
 * - Integrate parse → validation → execution flow
 * - Configure default help display behavior
 * - Debug mode options
 */
describe("runCommand", () => {
  describe("Full execution flow", () => {
    it("should parse, validate, and run command", async () => {
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: z.string(),
        }),
        run: runFn,
      });

      await runCommand(cmd, ["--name", "John"]);

      expect(runFn).toHaveBeenCalledWith({ name: "John" });
    });

    it("should handle positional arguments", async () => {
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          file: arg(z.string(), { positional: true }),
        }),
        run: runFn,
      });

      await runCommand(cmd, ["input.txt"]);

      expect(runFn).toHaveBeenCalledWith({ file: "input.txt" });
    });

    it("should apply default values", async () => {
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: runFn,
      });

      await runCommand(cmd, []);

      expect(runFn).toHaveBeenCalledWith({ verbose: false });
    });

    it("should return result from run function", async () => {
      const cmd = defineCommand({
        name: "test",
        run: () => ({ success: true }),
      });

      const result = await runCommand(cmd, []);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result).toEqual({ success: true });
      }
    });
  });

  describe("Help handling", () => {
    it("should show help on --help flag", async () => {
      using console = spyOnConsoleLog();

      const cmd = defineCommand({
        name: "my-cli",
        description: "Test CLI",
        args: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Enable verbose mode",
          }),
        }),
      });

      const result = await runCommand(cmd, ["--help"]);

      expect(console).toHaveBeenCalled();
      const output = console.getLogs()[0] ?? "";
      expect(output).toContain("my-cli");
      expect(output).toContain("Test CLI");
      expect(result.exitCode).toBe(0);
    });

    it("should show help on -h flag", async () => {
      using console = spyOnConsoleLog();

      const cmd = defineCommand({ name: "cli" });

      await runCommand(cmd, ["-h"]);

      expect(console).toHaveBeenCalled();
    });

    it("should show --help-all option when subcommands exist", async () => {
      using console = spyOnConsoleLog();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      await runCommand(cmd, ["--help"]);

      const output = console.getLogs()[0] ?? "";
      expect(output).toContain("--help-all");
    });

    it("should show subcommand options on --help-all", async () => {
      using console = spyOnConsoleLog();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              output: arg(z.string().default("dist"), {
                alias: "o",
                description: "Output directory",
              }),
            }),
          }),
        },
      });

      await runCommand(cmd, ["--help-all"]);

      const output = console.getLogs()[0] ?? "";
      expect(output).toContain("build");
      expect(output).toContain("--output");
      expect(output).toContain("Output directory");
    });

    it("should show subcommand help on subcmd --help", async () => {
      using console = spyOnConsoleLog();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            description: "Build the project",
            args: z.object({
              output: arg(z.string().default("dist"), { alias: "o" }),
            }),
          }),
        },
      });

      await runCommand(cmd, ["build", "--help"]);

      const output = console.getLogs()[0] ?? "";
      expect(output).toContain("build");
      expect(output).toContain("Build the project");
      expect(output).toContain("--output");
    });
  });

  describe("Validation errors", () => {
    it("should show error for invalid arguments", async () => {
      using _consoleSpy = spyOnConsoleError();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          port: z.coerce.number(),
        }),
      });

      const result = await runCommand(cmd, ["--port", "not-a-number"]);

      expect(result.exitCode).toBe(1);
    });

    it("should show error for missing required arguments", async () => {
      using _consoleSpy = spyOnConsoleError();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: z.string(),
        }),
      });

      const result = await runCommand(cmd, []);

      expect(result.exitCode).toBe(1);
    });

    it("should not display validation errors directly via console.error in runCommand", async () => {
      using consoleSpy = spyOnConsoleError();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: z.string(),
        }),
      });

      const result = await runCommand(cmd, []);

      expect(result.exitCode).toBe(1);
      expect(result.success).toBe(false);
      // runCommand (programmatic API) should NOT display errors itself;
      // it should only return them in result.error for the caller to handle
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("should return validation error message in result.error for caller to handle", async () => {
      using _consoleSpy = spyOnConsoleError();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: z.string(),
        }),
      });

      const result = await runCommand(cmd, []);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toContain("name");
      }
    });

    it("should not display errors directly for unknown flags in strict mode", async () => {
      using consoleSpy = spyOnConsoleError();

      const cmd = defineCommand({
        name: "test",
        args: z.strictObject({
          verbose: z.boolean().default(false),
        }),
      });

      const result = await runCommand(cmd, ["--unknown-flag"]);

      expect(result.success).toBe(false);
      // runCommand should NOT display errors itself
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe("Subcommand routing", () => {
    it("should route to subcommand", async () => {
      const buildFn = vi.fn();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              watch: arg(z.boolean().default(false), { alias: "w" }),
            }),
            run: buildFn,
          }),
        },
      });

      await runCommand(cmd, ["build", "--watch"]);

      expect(buildFn).toHaveBeenCalledWith({ watch: true });
    });

    it("should show help when subcommand not specified", async () => {
      using console = spyOnConsoleLog();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      await runCommand(cmd, []);

      expect(console).toHaveBeenCalled();
    });
  });

  describe("Unknown flags", () => {
    it("should warn about unknown flags with default z.object (strip mode)", async () => {
      using consoleSpy = spyOnConsoleError();
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: z.boolean().default(false),
        }),
        run: runFn,
      });

      const result = await runCommand(cmd, ["--unknown-flag"]);

      // Strip mode: should warn but continue execution
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] ?? "";
      expect(output).toContain("Warning");
      expect(output).toContain("unknown-flag");
      expect(runFn).toHaveBeenCalled(); // Command should still run
      expect(result.success).toBe(true);
    });

    it("should error on unknown flags with z.strictObject (strict mode)", async () => {
      using consoleSpy = spyOnConsoleError();
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.strictObject({
          verbose: z.boolean().default(false),
        }),
        run: runFn,
      });

      const result = await runCommand(cmd, ["--unknown-flag"]);

      // Strict mode: should error and not continue execution
      // runCommand (programmatic API) should not display errors directly
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(runFn).not.toHaveBeenCalled(); // Command should not run
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      if (!result.success) {
        expect(result.error.message).toContain("Unknown flags");
        expect(result.error.message).not.toContain("Warning");
      }
    });

    it("should error on unknown flags with z.object().strict()", async () => {
      using consoleSpy = spyOnConsoleError();
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z
          .object({
            verbose: z.boolean().default(false),
          })
          .strict(),
        run: runFn,
      });

      const result = await runCommand(cmd, ["--unknown-flag"]);

      // Strict mode: should error and not continue execution
      // runCommand (programmatic API) should not display errors directly
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(runFn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it("should silently ignore unknown flags with z.looseObject (passthrough mode)", async () => {
      using consoleSpy = spyOnConsoleError();
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.looseObject({
          verbose: z.boolean().default(false),
        }),
        run: runFn,
      });

      const result = await runCommand(cmd, ["--unknown-flag"]);

      // Passthrough mode: should silently ignore and continue execution
      expect(consoleSpy).not.toHaveBeenCalled(); // No warning
      expect(runFn).toHaveBeenCalled(); // Command should run
      expect(result.success).toBe(true);
    });

    it("should silently ignore unknown flags with z.object().passthrough()", async () => {
      using consoleSpy = spyOnConsoleError();
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z
          .object({
            verbose: z.boolean().default(false),
          })
          .passthrough(),
        run: runFn,
      });

      const result = await runCommand(cmd, ["--unknown-flag"]);

      // Passthrough mode: should silently ignore and continue execution
      expect(consoleSpy).not.toHaveBeenCalled(); // No warning
      expect(runFn).toHaveBeenCalled(); // Command should run
      expect(result.success).toBe(true);
    });

    // Short option (alias) tests
    it("should warn about unknown short flags with default z.object (strip mode)", async () => {
      using consoleSpy = spyOnConsoleError();
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: runFn,
      });

      const result = await runCommand(cmd, ["-x"]); // Unknown short flag

      // Strip mode: should warn but continue execution
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] ?? "";
      expect(output).toContain("Warning");
      expect(runFn).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("should error on unknown short flags with z.strictObject (strict mode)", async () => {
      using consoleSpy = spyOnConsoleError();
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.strictObject({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: runFn,
      });

      const result = await runCommand(cmd, ["-x"]); // Unknown short flag

      // Strict mode: should error and not continue execution
      // runCommand (programmatic API) should not display errors directly
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(runFn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it("should silently ignore unknown short flags with z.looseObject (passthrough mode)", async () => {
      using consoleSpy = spyOnConsoleError();
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.looseObject({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: runFn,
      });

      const result = await runCommand(cmd, ["-x"]); // Unknown short flag

      // Passthrough mode: should silently ignore and continue execution
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(runFn).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });
});

describe("runMain displayErrors", () => {
  it("should display errors by default", async () => {
    using _argv = useArgv(["node", "test"]);
    using consoleSpy = spyOnConsoleError();
    using exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        name: z.string(),
      }),
    });

    await runMain(cmd);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleSpy.getLogs().join("\n")).toContain("name");
  });

  it("should suppress errors when displayErrors is false", async () => {
    using _argv = useArgv(["node", "test"]);
    using consoleSpy = spyOnConsoleError();
    using exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        name: z.string(),
      }),
    });

    await runMain(cmd, { displayErrors: false });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe("runMain internal subcommand bypass", () => {
  it("skips user setup/cleanup/prompt for `__`-prefixed registered subcommands", async () => {
    using _argv = useArgv(["node", "test", "__internal"]);
    using exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const setup = vi.fn();
    const cleanup = vi.fn();
    const prompt = vi.fn();
    let internalRan = false;

    const internal = defineCommand({
      name: "__internal",
      run: () => {
        internalRan = true;
      },
    });

    const cmd = defineCommand({
      name: "test",
      run: () => {},
      subCommands: { __internal: internal },
    });

    await runMain(cmd, { setup, cleanup, prompt });

    expect(internalRan).toBe(true);
    expect(setup).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("still runs user setup/cleanup for ordinary subcommands", async () => {
    using _argv = useArgv(["node", "test", "regular"]);
    using exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const setup = vi.fn();
    const cleanup = vi.fn();

    const regular = defineCommand({ name: "regular", run: () => {} });
    const cmd = defineCommand({
      name: "test",
      run: () => {},
      subCommands: { regular },
    });

    await runMain(cmd, { setup, cleanup });

    expect(setup).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("does not bypass when an unregistered `__`-prefixed positional is passed", async () => {
    // Defense in depth: we only bypass for subcommands that are actually
    // registered, so a stray `__foo` argument doesn't accidentally skip
    // user lifecycle.
    using _argv = useArgv(["node", "test", "__not-registered"]);
    using _exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const setup = vi.fn();
    const cmd = defineCommand({ name: "test", run: () => {} });

    await runMain(cmd, { setup });

    expect(setup).toHaveBeenCalled();
  });

  it("does not bypass when `__name` appears as a global option *value*", async () => {
    // `--name __internal` is a value for --name, not the subcommand
    // token. Without schema-aware scanning, the naive
    // "first non-flag token" check would mistakenly bypass lifecycle
    // for ordinary invocations whose option values happen to start
    // with `__`.
    using _argv = useArgv(["node", "test", "--name", "__internal"]);
    using _exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const setup = vi.fn();
    const internal = defineCommand({ name: "__internal", run: () => {} });
    const cmd = defineCommand({
      name: "test",
      run: () => {},
      subCommands: { __internal: internal },
    });

    await runMain(cmd, {
      setup,
      globalArgs: z.object({ name: arg(z.string().optional(), {}) }),
    });

    expect(setup).toHaveBeenCalled();
  });
});

describe("runMain onUnknownSubcommand", () => {
  it("invokes the handler with the unknown name and forwarded args, exiting with its code", async () => {
    using _argv = useArgv(["node", "test", "plugin-name", "foo", "--bar"]);
    using exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const onUnknownSubcommand = vi.fn().mockResolvedValue(3);
    const known = defineCommand({ name: "known", run: () => {} });
    const cmd = defineCommand({ name: "test", subCommands: { known } });

    await runMain(cmd, { onUnknownSubcommand });

    expect(onUnknownSubcommand).toHaveBeenCalledWith({
      commandPath: [],
      name: "plugin-name",
      args: ["foo", "--bar"],
    });
    expect(exitSpy).toHaveBeenCalledWith(3);
  });

  it("forwards --help when it follows the unknown name", async () => {
    using _argv = useArgv(["node", "test", "plugin-name", "--help"]);
    using _exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const onUnknownSubcommand = vi.fn().mockReturnValue(0);
    const known = defineCommand({ name: "known", run: () => {} });
    const cmd = defineCommand({ name: "test", subCommands: { known } });

    await runMain(cmd, { onUnknownSubcommand });

    expect(onUnknownSubcommand).toHaveBeenCalledWith({
      commandPath: [],
      name: "plugin-name",
      args: ["--help"],
    });
  });

  it("does not invoke the handler for known subcommands", async () => {
    using _argv = useArgv(["node", "test", "known"]);
    using _exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const onUnknownSubcommand = vi.fn();
    const knownRun = vi.fn();
    const known = defineCommand({ name: "known", run: knownRun });
    const cmd = defineCommand({ name: "test", subCommands: { known } });

    await runMain(cmd, { onUnknownSubcommand });

    expect(onUnknownSubcommand).not.toHaveBeenCalled();
    expect(knownRun).toHaveBeenCalled();
  });

  it("falls back to default behavior when the handler returns undefined", async () => {
    using _argv = useArgv(["node", "test", "plugin-name"]);
    using exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const onUnknownSubcommand = vi.fn().mockReturnValue(undefined);
    const setup = vi.fn();
    const known = defineCommand({ name: "known", run: () => {} });
    const cmd = defineCommand({ name: "test", subCommands: { known } });

    await runMain(cmd, { onUnknownSubcommand, setup });

    expect(onUnknownSubcommand).toHaveBeenCalled();
    // Not handled → host CLI lifecycle proceeds (setup runs, help is shown).
    expect(setup).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalled();
  });

  it("does not invoke the handler when no positional is present", async () => {
    using _argv = useArgv(["node", "test", "--help"]);
    using _exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const onUnknownSubcommand = vi.fn();
    const known = defineCommand({ name: "known", run: () => {} });
    const cmd = defineCommand({ name: "test", subCommands: { known } });

    await runMain(cmd, { onUnknownSubcommand });

    expect(onUnknownSubcommand).not.toHaveBeenCalled();
  });

  it("does not treat a global option value as an unknown subcommand", async () => {
    using _argv = useArgv(["node", "test", "--name", "value"]);
    using _exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const onUnknownSubcommand = vi.fn();
    const known = defineCommand({ name: "known", run: () => {} });
    const cmd = defineCommand({ name: "test", subCommands: { known } });

    await runMain(cmd, {
      onUnknownSubcommand,
      globalArgs: z.object({ name: arg(z.string().optional(), {}) }),
    });

    expect(onUnknownSubcommand).not.toHaveBeenCalled();
  });

  it("dispatches for an unknown subcommand nested under a known parent", async () => {
    using _argv = useArgv(["node", "test", "parent", "plugin-name", "rest", "--flag"]);
    using exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const onUnknownSubcommand = vi.fn().mockResolvedValue(5);
    const child = defineCommand({ name: "child", run: () => {} });
    const parent = defineCommand({ name: "parent", subCommands: { child } });
    const cmd = defineCommand({ name: "test", subCommands: { parent } });

    await runMain(cmd, { onUnknownSubcommand });

    expect(onUnknownSubcommand).toHaveBeenCalledWith({
      commandPath: ["parent"],
      name: "plugin-name",
      args: ["rest", "--flag"],
    });
    expect(exitSpy).toHaveBeenCalledWith(5);
  });

  it("does not dispatch for a known nested subcommand", async () => {
    using _argv = useArgv(["node", "test", "parent", "child"]);
    using _exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const onUnknownSubcommand = vi.fn();
    const childRun = vi.fn();
    const child = defineCommand({ name: "child", run: childRun });
    const parent = defineCommand({ name: "parent", subCommands: { child } });
    const cmd = defineCommand({ name: "test", subCommands: { parent } });

    await runMain(cmd, { onUnknownSubcommand });

    expect(onUnknownSubcommand).not.toHaveBeenCalled();
    expect(childRun).toHaveBeenCalled();
  });
});

describe("runMain runMainHook", () => {
  it("invokes the hook once with the parsed argv before any command execution", async () => {
    using _argv = useArgv(["node", "test", "--flag", "value"]);
    using _exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const hook = vi.fn();

    const cmd = defineCommand({ name: "test", run: () => {} });
    cmd.runMainHook = hook;

    await runMain(cmd);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(["--flag", "value"]);
  });

  it("swallows hook errors so a misbehaving hook never blocks the CLI", async () => {
    using _argv = useArgv(["node", "test"]);
    using exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const runFn = vi.fn();

    const cmd = defineCommand({ name: "test", run: runFn });
    cmd.runMainHook = () => {
      throw new Error("hook blew up");
    };

    await runMain(cmd);

    // The user command must still run despite the hook throwing.
    expect(runFn).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
