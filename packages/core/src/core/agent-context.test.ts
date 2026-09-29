import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { spyOnConsoleLog } from "../../../../tests/utils/console.js";
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

const AGENT_HELP = "AGENTS: pass --json and parse stdout.";

const asAgent = () => {
  vi.stubEnv("POLITTY_NO_AGENT", "");
  vi.stubEnv("AI_AGENT", "codex_cli");
};

const asHuman = () => {
  vi.stubEnv("POLITTY_NO_AGENT", "1");
};

const groupCli = () =>
  defineCommand({
    name: "cli",
    subCommands: {
      build: defineCommand({ name: "build", description: "Build it", run: () => {} }),
    },
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("agentHelp", () => {
  describe("when an agent is detected", () => {
    beforeEach(asAgent);

    it("is printed above the normal --help output", async () => {
      using console = spyOnConsoleLog();

      await runCommand(defineCommand({ name: "cli", description: "Test CLI" }), ["--help"], {
        agentHelp: AGENT_HELP,
      });

      const output = console.getLogs()[0] ?? "";
      expect(output).toContain(AGENT_HELP);
      expect(output.indexOf(AGENT_HELP)).toBeLessThan(output.indexOf("Test CLI"));
    });

    it("is printed on --help-all", async () => {
      using console = spyOnConsoleLog();

      await runCommand(groupCli(), ["--help-all"], { agentHelp: AGENT_HELP });

      expect(console.getLogs()[0]).toContain(AGENT_HELP);
    });

    it("is printed on the help shown when no subcommand is given", async () => {
      using console = spyOnConsoleLog();

      await runCommand(groupCli(), [], { agentHelp: AGENT_HELP });

      expect(console.getLogs()[0]).toContain(AGENT_HELP);
    });

    it("is printed on the help shown for an unknown subcommand with --help", async () => {
      using console = spyOnConsoleLog();

      const result = await runCommand(groupCli(), ["bulid", "--help"], { agentHelp: AGENT_HELP });

      expect(result.exitCode).toBe(1);
      expect(console.getLogs()[0]).toContain(AGENT_HELP);
    });

    it("is rendered as Markdown like notes", async () => {
      using console = spyOnConsoleLog();

      await runCommand(defineCommand({ name: "cli" }), ["--help"], {
        agentHelp: "Use `--json` output.",
      });

      const output = console.getLogs()[0] ?? "";
      expect(output).toContain("--json");
      expect(output).not.toContain("`--json`");
    });

    it("passes the detected agent and the command path to a function form", async () => {
      using _console = spyOnConsoleLog();
      const agentHelp = vi.fn(() => AGENT_HELP);

      await runCommand(groupCli(), ["build", "--help"], { agentHelp });

      expect(agentHelp).toHaveBeenCalledWith({
        agent: { id: "codex_cli", rawId: "codex_cli" },
        commandPath: ["build"],
      });
    });

    it("prints nothing extra when the function form returns undefined", async () => {
      using console = spyOnConsoleLog();

      await runCommand(defineCommand({ name: "cli" }), ["--help"]);
      await runCommand(defineCommand({ name: "cli" }), ["--help"], { agentHelp: () => undefined });

      const [withoutOption, withUndefined] = console.getLogs();
      expect(withUndefined).toBe(withoutOption);
    });

    it("is added as the agentHelp field of --help-json", async () => {
      using console = spyOnConsoleLog();

      await runCommand(defineCommand({ name: "cli" }), ["--help-json"], { agentHelp: AGENT_HELP });

      expect(JSON.parse(console.getLogs()[0] ?? "")).toMatchObject({ agentHelp: AGENT_HELP });
    });

    it("is printed by runMain", async () => {
      using _argv = useArgv(["node", "cli", "--help"]);
      using console = spyOnConsoleLog();
      using _exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      await runMain(defineCommand({ name: "cli" }), { agentHelp: AGENT_HELP });

      expect(console.getLogs()[0]).toContain(AGENT_HELP);
    });
  });

  describe("when no agent is detected", () => {
    beforeEach(asHuman);

    it("is not printed on --help", async () => {
      using console = spyOnConsoleLog();

      await runCommand(defineCommand({ name: "cli" }), ["--help"], { agentHelp: AGENT_HELP });

      expect(console.getLogs()[0]).not.toContain(AGENT_HELP);
    });

    it("does not call the function form", async () => {
      using _console = spyOnConsoleLog();
      const agentHelp = vi.fn(() => AGENT_HELP);

      await runCommand(defineCommand({ name: "cli" }), ["--help"], { agentHelp });

      expect(agentHelp).not.toHaveBeenCalled();
    });

    it("is not added to --help-json", async () => {
      using console = spyOnConsoleLog();

      await runCommand(defineCommand({ name: "cli" }), ["--help-json"], { agentHelp: AGENT_HELP });

      expect(JSON.parse(console.getLogs()[0] ?? "")).not.toHaveProperty("agentHelp");
    });
  });
});

describe("$agent", () => {
  it("reports the detected agent to run", async () => {
    asAgent();
    const runFn = vi.fn();
    const cmd = defineCommand({
      name: "cli",
      args: z.object({ name: arg(z.string()) }),
      run: runFn,
    });

    await runCommand(cmd, ["--name", "Alice"]);

    expect(runFn.mock.calls[0]?.[0].$agent).toEqual({ id: "codex_cli", rawId: "codex_cli" });
  });

  it("reports the detected agent to run of a command without an args schema", async () => {
    asAgent();
    const runFn = vi.fn();

    await runCommand(defineCommand({ name: "cli", run: runFn }), []);

    expect(runFn.mock.calls[0]?.[0].$agent).toEqual({ id: "codex_cli", rawId: "codex_cli" });
  });

  it("reports the detected agent to the command setup and cleanup hooks", async () => {
    asAgent();
    const setup = vi.fn();
    const cleanup = vi.fn();

    await runCommand(defineCommand({ name: "cli", setup, cleanup, run: () => {} }), []);

    expect(setup.mock.calls[0]?.[0].args.$agent).toEqual({ id: "codex_cli", rawId: "codex_cli" });
    expect(cleanup.mock.calls[0]?.[0].args.$agent).toEqual({ id: "codex_cli", rawId: "codex_cli" });
  });

  it("is undefined when no agent is detected", async () => {
    asHuman();
    const runFn = vi.fn();

    await runCommand(defineCommand({ name: "cli", run: runFn }), []);

    expect(runFn.mock.calls[0]?.[0].$agent).toBeUndefined();
  });

  it("is not an enumerable key of args", async () => {
    asAgent();
    const runFn = vi.fn();
    const cmd = defineCommand({
      name: "cli",
      args: z.object({ name: arg(z.string()) }),
      run: runFn,
    });

    await runCommand(cmd, ["--name", "Alice"]);

    expect(Object.keys(runFn.mock.calls[0]?.[0])).toEqual(["name"]);
  });
});

describe("global setup/cleanup agent", () => {
  it("reports the detected agent to runCommand's global setup and cleanup", async () => {
    asAgent();
    const setup = vi.fn();
    const cleanup = vi.fn();

    await runCommand(defineCommand({ name: "cli", run: () => {} }), [], { setup, cleanup });

    expect(setup).toHaveBeenCalledWith({ agent: { id: "codex_cli", rawId: "codex_cli" } });
    expect(cleanup).toHaveBeenCalledWith({
      agent: { id: "codex_cli", rawId: "codex_cli" },
      error: undefined,
    });
  });

  it("reports the detected agent to runMain's global setup and cleanup", async () => {
    asAgent();
    using _argv = useArgv(["node", "cli"]);
    using _exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const setup = vi.fn();
    const cleanup = vi.fn();

    await runMain(defineCommand({ name: "cli", run: () => {} }), { setup, cleanup });

    expect(setup).toHaveBeenCalledWith({ agent: { id: "codex_cli", rawId: "codex_cli" } });
    expect(cleanup).toHaveBeenCalledWith({
      agent: { id: "codex_cli", rawId: "codex_cli" },
      error: undefined,
    });
  });

  it("reports the detected agent to global cleanup when global setup fails", async () => {
    asAgent();
    const cleanup = vi.fn();

    await runCommand(defineCommand({ name: "cli", run: () => {} }), [], {
      setup: () => {
        throw new Error("setup failed");
      },
      cleanup,
    });

    expect(cleanup).toHaveBeenCalledWith({
      agent: { id: "codex_cli", rawId: "codex_cli" },
      error: expect.any(Error),
    });
  });
});
