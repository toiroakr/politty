import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineCommand } from "../core/command.js";
import { executeLifecycle } from "./command-runner.js";

/**
 * Task 7.2: Command lifecycle tests
 * - Execute setup → run → cleanup in sequence
 * - Support async run function
 * - Set appropriate exit code on error
 * - SIGINT/SIGTERM cleanup
 */
describe("executeLifecycle", () => {
  it("should execute run function with validated args", async () => {
    const runFn = vi.fn().mockReturnValue("done");

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        name: z.string(),
      }),
      run: runFn,
    });

    const result = await executeLifecycle(cmd, { name: "John" });

    expect(runFn).toHaveBeenCalledWith({ name: "John" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("done");
    }
  });

  it("should execute setup before run", async () => {
    const order: string[] = [];

    const cmd = defineCommand({
      name: "test",
      setup: () => {
        order.push("setup");
      },
      run: () => {
        order.push("run");
      },
    });

    await executeLifecycle(cmd, {});

    expect(order).toEqual(["setup", "run"]);
  });

  it("should execute cleanup after run", async () => {
    const order: string[] = [];

    const cmd = defineCommand({
      name: "test",
      run: () => {
        order.push("run");
      },
      cleanup: () => {
        order.push("cleanup");
      },
    });

    await executeLifecycle(cmd, {});

    expect(order).toEqual(["run", "cleanup"]);
  });

  it("should execute cleanup even if run throws", async () => {
    const cleanupFn = vi.fn();

    const cmd = defineCommand({
      name: "test",
      run: () => {
        throw new Error("Run error");
      },
      cleanup: cleanupFn,
    });

    const result = await executeLifecycle(cmd, {});

    expect(cleanupFn).toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
  });

  it("should pass error to cleanup context", async () => {
    let capturedError: Error | undefined;

    const cmd = defineCommand({
      name: "test",
      run: () => {
        throw new Error("Test error");
      },
      cleanup: ({ error }) => {
        capturedError = error;
      },
    });

    await executeLifecycle(cmd, {});

    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError?.message).toBe("Test error");
  });

  it("should support async run function", async () => {
    const cmd = defineCommand({
      name: "test",
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "async result";
      },
    });

    const result = await executeLifecycle(cmd, {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("async result");
    }
  });

  it("should support async setup and cleanup", async () => {
    const order: string[] = [];

    const cmd = defineCommand({
      name: "test",
      setup: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("setup");
      },
      run: () => {
        order.push("run");
      },
      cleanup: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("cleanup");
      },
    });

    await executeLifecycle(cmd, {});

    expect(order).toEqual(["setup", "run", "cleanup"]);
  });

  it("should return exit code 1 on error", async () => {
    const cmd = defineCommand({
      name: "test",
      run: () => {
        throw new Error("Failure");
      },
    });

    const result = await executeLifecycle(cmd, {});

    expect(result.exitCode).toBe(1);
  });

  it("should return exit code 0 on success", async () => {
    const cmd = defineCommand({
      name: "test",
      run: () => "success",
    });

    const result = await executeLifecycle(cmd, {});

    expect(result.exitCode).toBe(0);
  });

  it("should work with no run function", async () => {
    const cmd = defineCommand({
      name: "empty",
    });

    const result = await executeLifecycle(cmd, {});

    expect(result.exitCode).toBe(0);
  });
});
