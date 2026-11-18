import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { spyOnConsoleLog } from "../../../../tests/utils/console.js";
import type { AnyCommand } from "../types.js";
import { arg } from "./arg-registry.js";
import { defineCommand } from "./command.js";
import {
  clearRecordedCli,
  ensureRecordedCli,
  recordCli,
  RECORDED_CLI_KEY,
} from "./recorded-cli.js";
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

  it("does not apply the recorded hooks again to a runCommand call made inside them", async () => {
    const other = defineCommand({ name: "other", run: () => {} });
    const deploy = deployWith(() => {});
    const setup = vi.fn(async () => {
      await runCommand(other, []);
    });
    const cleanup = vi.fn(async () => {
      await runCommand(other, []);
    });
    recordCli(defineCommand({ name: "cli", subCommands: { other, deploy } }), {
      globalArgs,
      setup,
      cleanup,
    });

    const result = await runCommand(deploy, ["prod"]);

    expect(result.success).toBe(true);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("applies the recorded hooks to runs that start independently at the same time", async () => {
    const deploy = deployWith(() => {});
    const setup = vi.fn();
    recordCli(nested(deploy), { globalArgs, setup });

    await Promise.all([runCommand(deploy, ["a"]), runCommand(deploy, ["b"])]);

    expect(setup).toHaveBeenCalledTimes(2);
  });

  it("does not inherit the recorded options for an internal command, as the real CLI does not", async () => {
    const setup = vi.fn();
    const run = vi.fn();
    const internal = defineCommand({ name: "__refresh-completion", run });
    recordCli(defineCommand({ name: "cli", subCommands: { "__refresh-completion": internal } }), {
      globalArgs,
      setup,
    });

    const result = await runCommand(internal, []);

    expect(result.success).toBe(true);
    expect(run).toHaveBeenCalledExactlyOnceWith({});
    expect(setup).not.toHaveBeenCalled();
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

const slotOf = (): Record<string, unknown> =>
  ((globalThis as unknown as Record<symbol, Record<string, unknown>>)[
    Symbol.for(RECORDED_CLI_KEY)
  ] ??= {});

describe("ensureRecordedCli", () => {
  it("runs the registered loader once for callers that arrive together", async () => {
    const loader = vi.fn(async () => {});
    slotOf()["loader"] = loader;

    await Promise.all([ensureRecordedCli(), ensureRecordedCli()]);
    await ensureRecordedCli();

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not run the loader when a CLI is already recorded", async () => {
    const loader = vi.fn(async () => {});
    slotOf()["loader"] = loader;
    recordCli(defineCommand({ name: "cli" }), {});

    await ensureRecordedCli();

    expect(loader).not.toHaveBeenCalled();
  });

  it("runs the loader again after it failed", async () => {
    const loader = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("entry exploded"))
      .mockResolvedValueOnce(undefined);
    slotOf()["loader"] = loader;

    await expect(ensureRecordedCli()).rejects.toThrow("entry exploded");
    await ensureRecordedCli();

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no loader is registered", async () => {
    await expect(ensureRecordedCli()).resolves.toBeUndefined();
  });
});

describe("runCommand with a registered loader", () => {
  it("loads the CLI before it looks the command up", async () => {
    const run = vi.fn();
    const deploy = deployWith(run);
    slotOf()["loader"] = async () => {
      recordCli(nested(deploy), { globalArgs });
    };

    await runCommand(deploy, ["--verbose", "prod"]);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
  });
});

describe("runCommand calls that arrive while the entry is being loaded", () => {
  it("make independent callers wait for the recording", async () => {
    const run = vi.fn();
    const deploy = deployWith(run);
    slotOf()["loader"] = async () => {
      slotOf()["capturing"] = true;
      await new Promise((resolve) => setTimeout(resolve, 20));
      recordCli(nested(deploy), { globalArgs });
      delete slotOf()["capturing"];
    };

    await Promise.all([
      runCommand(deploy, ["--verbose", "a"]),
      runCommand(deploy, ["--verbose", "b"]),
    ]);

    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, expect.objectContaining({ verbose: true }));
    expect(run).toHaveBeenNthCalledWith(2, expect.objectContaining({ verbose: true }));
  });
});

describe("runCommand while the entry is being recorded", () => {
  it("does not wait for the loader that is waiting for the entry", async () => {
    const other = defineCommand({ name: "other", run: () => {} });
    slotOf()["loader"] = async () => {
      slotOf()["capturing"] = true;
      await runCommand(other, []);
      delete slotOf()["capturing"];
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      runCommand(other, []),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve("deadlock"), 1000);
      }),
    ]).finally(() => clearTimeout(timer));

    expect(result).not.toBe("deadlock");
  });
});

describe("hook scope across copies of the core", () => {
  it("is visible to another copy of the module inside a recorded hook", async () => {
    let seenByOtherCopy: boolean | undefined;
    const root = defineCommand({ name: "cli", run: () => {} });
    recordCli(root, {
      setup: async () => {
        vi.resetModules();
        const other = await import("./recorded-cli.js");
        seenByOtherCopy = other.isInRecordedHook();
      },
    });

    await runCommand(root, []);

    expect(seenByOtherCopy).toBe(true);
  });
});

describe("clearRecordedCli", () => {
  it("forgets which entry was recorded", () => {
    const slotKey = Symbol.for(RECORDED_CLI_KEY);
    Object.assign(globalThis, { [slotKey]: { entry: "file:///cli.ts" } });

    clearRecordedCli();

    expect((globalThis as unknown as Record<symbol, object>)[slotKey]).not.toHaveProperty("entry");
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
