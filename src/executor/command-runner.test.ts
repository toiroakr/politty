import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { runCommand } from "./command-runner.js";
import { defineCommand } from "../core/command.js";

/**
 * Task 7.2: コマンドランナーのテスト
 * - setup → run → cleanup のライフサイクルを順次実行
 * - 非同期のrun関数をサポート
 * - エラー時に適切な終了コードを設定
 * - SIGINT/SIGTERM時のクリーンアップ
 */
describe("CommandRunner", () => {
  describe("runCommand", () => {
    it("should execute run function with validated args", async () => {
      const runFn = vi.fn().mockReturnValue("done");

      const cmd = defineCommand({
        name: "test",
        args: {
          name: { schema: z.string() },
        },
        run: runFn,
      });

      const result = await runCommand(cmd, { name: "John" }, []);

      expect(runFn).toHaveBeenCalledWith({
        args: { name: "John" },
        rawArgs: [],
      });
      expect(result.exitCode).toBe(0);
      expect(result.result).toBe("done");
    });

    it("should execute setup before run", async () => {
      const order: string[] = [];

      const cmd = defineCommand({
        setup: () => {
          order.push("setup");
        },
        run: () => {
          order.push("run");
        },
      });

      await runCommand(cmd, {}, []);

      expect(order).toEqual(["setup", "run"]);
    });

    it("should execute cleanup after run", async () => {
      const order: string[] = [];

      const cmd = defineCommand({
        run: () => {
          order.push("run");
        },
        cleanup: () => {
          order.push("cleanup");
        },
      });

      await runCommand(cmd, {}, []);

      expect(order).toEqual(["run", "cleanup"]);
    });

    it("should execute cleanup even if run throws", async () => {
      const cleanupFn = vi.fn();

      const cmd = defineCommand({
        run: () => {
          throw new Error("Run error");
        },
        cleanup: cleanupFn,
      });

      const result = await runCommand(cmd, {}, []);

      expect(cleanupFn).toHaveBeenCalled();
      expect(result.exitCode).toBe(1);
    });

    it("should pass error to cleanup context", async () => {
      let capturedError: Error | undefined;

      const cmd = defineCommand({
        run: () => {
          throw new Error("Test error");
        },
        cleanup: ({ error }) => {
          capturedError = error;
        },
      });

      await runCommand(cmd, {}, []);

      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError?.message).toBe("Test error");
    });

    it("should support async run function", async () => {
      const cmd = defineCommand({
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "async result";
        },
      });

      const result = await runCommand(cmd, {}, []);

      expect(result.result).toBe("async result");
      expect(result.exitCode).toBe(0);
    });

    it("should support async setup and cleanup", async () => {
      const order: string[] = [];

      const cmd = defineCommand({
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

      await runCommand(cmd, {}, []);

      expect(order).toEqual(["setup", "run", "cleanup"]);
    });

    it("should return exit code 1 on error", async () => {
      const cmd = defineCommand({
        run: () => {
          throw new Error("Failure");
        },
      });

      const result = await runCommand(cmd, {}, []);

      expect(result.exitCode).toBe(1);
    });

    it("should return exit code 0 on success", async () => {
      const cmd = defineCommand({
        run: () => "success",
      });

      const result = await runCommand(cmd, {}, []);

      expect(result.exitCode).toBe(0);
    });

    it("should work with no run function", async () => {
      const cmd = defineCommand({
        name: "empty",
      });

      const result = await runCommand(cmd, {}, []);

      expect(result.exitCode).toBe(0);
    });
  });
});
