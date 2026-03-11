import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { arg, defineCommand, runCommand } from "../index.js";

describe("arg effect", () => {
  it("should execute effect after parsing", async () => {
    const effect = vi.fn();

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          effect,
        }),
      }),
      run: () => {},
    });

    await runCommand(cmd, ["--verbose"]);

    expect(effect).toHaveBeenCalledOnce();
    expect(effect).toHaveBeenCalledWith(true, {
      name: "verbose",
      args: { verbose: true },
      globalArgs: {},
    });
  });

  it("should receive transformed value from zod", async () => {
    const effect = vi.fn();

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        port: arg(
          z.coerce.number().transform((n) => n * 2),
          { effect },
        ),
      }),
      run: () => {},
    });

    await runCommand(cmd, ["--port", "4000"]);

    expect(effect).toHaveBeenCalledWith(8000, {
      name: "port",
      args: { port: 8000 },
      globalArgs: {},
    });
  });

  it("should execute effects in field definition order", async () => {
    const order: string[] = [];

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        first: arg(z.string().default("a"), {
          effect: () => {
            order.push("first");
          },
        }),
        second: arg(z.string().default("b"), {
          effect: () => {
            order.push("second");
          },
        }),
        third: arg(z.string().default("c"), {
          effect: () => {
            order.push("third");
          },
        }),
      }),
      run: () => {},
    });

    await runCommand(cmd, []);

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("should support async effects", async () => {
    const order: string[] = [];

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        name: arg(z.string(), {
          effect: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            order.push("effect-done");
          },
        }),
      }),
      setup: () => {
        order.push("setup");
      },
      run: () => {
        order.push("run");
      },
    });

    await runCommand(cmd, ["--name", "test"]);

    expect(order).toEqual(["effect-done", "setup", "run"]);
  });

  it("should propagate effect errors", async () => {
    const cmd = defineCommand({
      name: "test",
      args: z.object({
        name: arg(z.string(), {
          effect: () => {
            throw new Error("effect failed");
          },
        }),
      }),
      run: () => {},
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCommand(cmd, ["--name", "test"]);
    consoleSpy.mockRestore();

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("should not execute effects on --help", async () => {
    const effect = vi.fn();

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        name: arg(z.string().default("x"), { effect }),
      }),
      run: () => {},
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(cmd, ["--help"]);
    consoleSpy.mockRestore();

    expect(effect).not.toHaveBeenCalled();
  });

  it("should skip fields without effect", async () => {
    const effect = vi.fn();

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        name: arg(z.string(), { description: "no effect" }),
        verbose: arg(z.boolean().default(false), { effect }),
      }),
      run: () => {},
    });

    await runCommand(cmd, ["--name", "test", "--verbose"]);

    expect(effect).toHaveBeenCalledOnce();
    expect(effect).toHaveBeenCalledWith(true, {
      name: "verbose",
      args: { name: "test", verbose: true },
      globalArgs: {},
    });
  });

  describe("with globalArgs", () => {
    it("should execute effects for global args", async () => {
      const effect = vi.fn();

      const globalSchema = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v", effect }),
      });

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: arg(z.string()),
        }),
        run: () => {},
      });

      await runCommand(cmd, ["--verbose", "--name", "test"], { globalArgs: globalSchema });

      expect(effect).toHaveBeenCalledOnce();
      expect(effect).toHaveBeenCalledWith(true, {
        name: "verbose",
        args: { verbose: true },
        globalArgs: { verbose: true },
      });
    });

    it("should execute global effects before command effects", async () => {
      const order: string[] = [];

      const globalSchema = z.object({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          effect: () => {
            order.push("global");
          },
        }),
      });

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: arg(z.string(), {
            effect: () => {
              order.push("command");
            },
          }),
        }),
        run: () => {},
      });

      await runCommand(cmd, ["--verbose", "--name", "test"], { globalArgs: globalSchema });

      expect(order).toEqual(["global", "command"]);
    });

    it("should execute global effects for commands without args schema", async () => {
      const effect = vi.fn();

      const globalSchema = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v", effect }),
      });

      const cmd = defineCommand({
        name: "test",
        run: () => {},
      });

      const root = defineCommand({
        name: "root",
        subCommands: { test: cmd },
      });

      await runCommand(root, ["test", "--verbose"], { globalArgs: globalSchema });

      expect(effect).toHaveBeenCalledOnce();
      expect(effect).toHaveBeenCalledWith(true, {
        name: "verbose",
        args: { verbose: true },
        globalArgs: { verbose: true },
      });
    });

    it("should pass globalArgs to command effect context", async () => {
      const commandEffect = vi.fn();

      const globalSchema = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v" }),
      });

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: arg(z.string(), { effect: commandEffect }),
        }),
        run: () => {},
      });

      await runCommand(cmd, ["--verbose", "--name", "hello"], { globalArgs: globalSchema });

      expect(commandEffect).toHaveBeenCalledWith("hello", {
        name: "name",
        args: { name: "hello" },
        globalArgs: { verbose: true },
      });
    });

    it("should not execute global effects when command validation fails", async () => {
      const globalEffect = vi.fn();

      const globalSchema = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v", effect: globalEffect }),
      });

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: arg(z.string()),
        }),
        run: () => {},
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await runCommand(cmd, ["--verbose"], { globalArgs: globalSchema });
      consoleSpy.mockRestore();

      expect(result.success).toBe(false);
      expect(globalEffect).not.toHaveBeenCalled();
    });
  });
});
