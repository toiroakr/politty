import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { spyOnConsoleLog } from "../../../../tests/utils/console.js";
import type { AnyCommand } from "../types.js";
import { arg } from "./arg-registry.js";
import { defineCommand } from "./command.js";
import { clearRecordedCli, recordCli, RECORDED_CLI_KEY } from "./recorded-cli.js";
import { runCommand, runMain } from "./runner.js";

const globalArgs = z.object({ verbose: arg(z.boolean().default(false)) });

const deployWith = (run: (args: Record<string, unknown>) => void) =>
  defineCommand({
    name: "deploy",
    args: z.object({ target: arg(z.string(), { positional: true }) }),
    run,
  });

const nested = (deploy: AnyCommand) =>
  defineCommand({
    name: "cli",
    subCommands: { ops: defineCommand({ name: "ops", subCommands: { deploy } }) },
  });

afterEach(() => {
  clearRecordedCli();
});

describe("runCommand with a recorded CLI", () => {
  it("applies the recorded global args schema to a subcommand run on its own", async () => {
    const run = vi.fn();
    const deploy = deployWith(run);
    recordCli(nested(deploy), { globalArgs });

    const result = await runCommand(deploy, ["--verbose", "prod"]);

    expect(result.success).toBe(true);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ target: "prod", verbose: true }));
  });

  it("accepts a global flag given after the positional argument", async () => {
    const run = vi.fn();
    const deploy = deployWith(run);
    recordCli(nested(deploy), { globalArgs });

    await runCommand(deploy, ["prod", "--verbose"]);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
  });

  it("fills in the default of a global arg that was not passed", async () => {
    const run = vi.fn();
    const deploy = deployWith(run);
    recordCli(nested(deploy), { globalArgs });

    await runCommand(deploy, ["prod"]);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ verbose: false }));
  });

  it("keeps working when the subcommand moves under another parent", async () => {
    const run = vi.fn();
    const deploy = deployWith(run);
    recordCli(
      defineCommand({
        name: "cli",
        subCommands: { release: defineCommand({ name: "release", subCommands: { ship: deploy } }) },
      }),
      { globalArgs },
    );

    await runCommand(deploy, ["--verbose", "prod"]);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ target: "prod", verbose: true }));
  });

  it("runs the recorded global setup and cleanup around the subcommand", async () => {
    const calls: string[] = [];
    const deploy = deployWith(() => {
      calls.push("run");
    });
    recordCli(nested(deploy), {
      globalArgs,
      setup: () => {
        calls.push("setup");
      },
      cleanup: () => {
        calls.push("cleanup");
      },
    });

    await runCommand(deploy, ["prod"]);

    expect(calls).toEqual(["setup", "run", "cleanup"]);
  });

  it("shows the path from the recorded root in the help of the subcommand", async () => {
    const deploy = deployWith(() => {});
    recordCli(nested(deploy), { globalArgs });
    const log = spyOnConsoleLog();

    await runCommand(deploy, ["--help"]);

    expect(log.getLogs().join("\n")).toContain("cli ops deploy");
    log.mockRestore();
  });

  it("runs the recorded root itself with the recorded options", async () => {
    const run = vi.fn();
    const root = defineCommand({ name: "cli", run });
    recordCli(root, { globalArgs });

    await runCommand(root, ["--verbose"]);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
  });

  it("prefers a global args schema passed explicitly over the recorded one", async () => {
    const run = vi.fn();
    const deploy = deployWith(run);
    recordCli(nested(deploy), { globalArgs });
    const loud = z.object({ loud: arg(z.boolean().default(false)) });

    await runCommand(deploy, ["--loud", "prod"], { globalArgs: loud });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ loud: true }));
    expect(run).toHaveBeenCalledWith(expect.not.objectContaining({ verbose: expect.anything() }));
  });

  it("skips the recorded setup when setup is passed as undefined", async () => {
    const setup = vi.fn();
    const deploy = deployWith(() => {});
    recordCli(nested(deploy), { globalArgs, setup });

    const result = await runCommand(deploy, ["prod"], { setup: undefined });

    expect(result.success).toBe(true);
    expect(setup).not.toHaveBeenCalled();
  });

  it("does not use the recorded prompt resolver", async () => {
    const prompt = vi.fn();
    const deploy = deployWith(() => {});
    recordCli(nested(deploy), { globalArgs, prompt });

    const result = await runCommand(deploy, ["prod"]);

    expect(result.success).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("runs a command outside the recorded tree as it would without a recorded CLI", async () => {
    const setup = vi.fn();
    const run = vi.fn();
    recordCli(nested(deployWith(() => {})), { globalArgs, setup });
    const outside = defineCommand({
      name: "outside",
      args: z.object({ verbose: arg(z.string()) }),
      run,
    });

    const result = await runCommand(outside, ["--verbose", "text"]);

    expect(result.success).toBe(true);
    expect(run).toHaveBeenCalledWith({ verbose: "text" });
    expect(setup).not.toHaveBeenCalled();
  });

  it("runs as before when nothing is recorded", async () => {
    const run = vi.fn();
    const deploy = deployWith(run);

    await runCommand(deploy, ["prod"]);

    expect(run).toHaveBeenCalledWith({ target: "prod" });
  });
});

describe("runMain while recording the CLI", () => {
  const startRecording = () => {
    const onRecord = vi.fn();
    Object.assign(globalThis, {
      [Symbol.for(RECORDED_CLI_KEY)]: { capturing: true, onRecord },
    });
    return onRecord;
  };

  it("records the command and options without running the command", async () => {
    const run = vi.fn();
    const onRecord = startRecording();
    const root = defineCommand({ name: "cli", run });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    void runMain(root, { globalArgs });
    await Promise.resolve();

    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("makes the recorded CLI available to runCommand", async () => {
    startRecording();
    const run = vi.fn();
    const deploy = deployWith(run);
    void runMain(nested(deploy), { globalArgs });

    await runCommand(deploy, ["--verbose", "prod"]);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
  });

  it("never settles the returned promise so code after it does not run", async () => {
    startRecording();
    const after = vi.fn();

    void runMain(defineCommand({ name: "cli" })).then(after);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(after).not.toHaveBeenCalled();
  });
});
