import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineCommand } from "./command.js";
import { runCommand } from "./runner.js";

describe("global setup/cleanup", () => {
  it("should execute in order: global setup → command setup → run → command cleanup → global cleanup", async () => {
    const order: string[] = [];

    const cmd = defineCommand({
      name: "test",
      setup: () => {
        order.push("command-setup");
      },
      run: () => {
        order.push("run");
      },
      cleanup: () => {
        order.push("command-cleanup");
      },
    });

    await runCommand(cmd, [], {
      setup: () => {
        order.push("global-setup");
      },
      cleanup: () => {
        order.push("global-cleanup");
      },
    });

    expect(order).toEqual([
      "global-setup",
      "command-setup",
      "run",
      "command-cleanup",
      "global-cleanup",
    ]);
  });

  it("should skip command execution when global setup fails", async () => {
    const runFn = vi.fn();

    const cmd = defineCommand({
      name: "test",
      run: runFn,
    });

    const result = await runCommand(cmd, [], {
      setup: () => {
        throw new Error("Setup failed");
      },
    });

    expect(runFn).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Setup failed");
    }
    expect(result.exitCode).toBe(1);
  });

  it("should run global cleanup with error when global setup fails", async () => {
    const cleanupFn = vi.fn();

    const cmd = defineCommand({
      name: "test",
      run: () => {},
    });

    await runCommand(cmd, [], {
      setup: () => {
        throw new Error("Setup failed");
      },
      cleanup: cleanupFn,
    });

    expect(cleanupFn).toHaveBeenCalledWith({ error: expect.any(Error) });
    expect(cleanupFn.mock.calls[0]?.[0].error?.message).toBe("Setup failed");
  });

  it("should pass error to global cleanup when command fails", async () => {
    const cleanupFn = vi.fn();

    const cmd = defineCommand({
      name: "test",
      run: () => {
        throw new Error("Command failed");
      },
    });

    const result = await runCommand(cmd, [], {
      cleanup: cleanupFn,
    });

    expect(cleanupFn).toHaveBeenCalledWith({ error: expect.any(Error) });
    expect(cleanupFn.mock.calls[0]?.[0].error?.message).toBe("Command failed");
    expect(result.success).toBe(false);
  });

  it("should pass no error to global cleanup on success", async () => {
    const cleanupFn = vi.fn();

    const cmd = defineCommand({
      name: "test",
      run: () => "ok",
    });

    const result = await runCommand(cmd, [], {
      cleanup: cleanupFn,
    });

    expect(cleanupFn).toHaveBeenCalledWith({ error: undefined });
    expect(result.success).toBe(true);
  });

  it("should return failure when global cleanup throws and no prior error", async () => {
    const cmd = defineCommand({
      name: "test",
      run: () => "ok",
    });

    const result = await runCommand(cmd, [], {
      cleanup: () => {
        throw new Error("Cleanup failed");
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Cleanup failed");
    }
  });

  it("should preserve original error when global cleanup also throws", async () => {
    const cmd = defineCommand({
      name: "test",
      run: () => {
        throw new Error("Original error");
      },
    });

    const result = await runCommand(cmd, [], {
      cleanup: () => {
        throw new Error("Cleanup error");
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Original error");
    }
  });

  it("should support async global setup and cleanup", async () => {
    const order: string[] = [];

    const cmd = defineCommand({
      name: "test",
      run: () => {
        order.push("run");
      },
    });

    await runCommand(cmd, [], {
      setup: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("global-setup");
      },
      cleanup: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("global-cleanup");
      },
    });

    expect(order).toEqual(["global-setup", "run", "global-cleanup"]);
  });

  it("should work with only setup (no cleanup)", async () => {
    const setupFn = vi.fn();

    const cmd = defineCommand({
      name: "test",
      run: () => "ok",
    });

    const result = await runCommand(cmd, [], {
      setup: setupFn,
    });

    expect(setupFn).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("should work with only cleanup (no setup)", async () => {
    const cleanupFn = vi.fn();

    const cmd = defineCommand({
      name: "test",
      run: () => "ok",
    });

    const result = await runCommand(cmd, [], {
      cleanup: cleanupFn,
    });

    expect(cleanupFn).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("should work with args and global setup/cleanup", async () => {
    const cleanupFn = vi.fn();

    const cmd = defineCommand({
      name: "test",
      args: z.object({ name: z.string() }),
      run: (args) => args.name,
    });

    const result = await runCommand(cmd, ["--name", "hello"], {
      setup: () => {},
      cleanup: cleanupFn,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("hello");
    }
    expect(cleanupFn).toHaveBeenCalledWith({ error: undefined });
  });
});
