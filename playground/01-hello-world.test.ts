import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { command } from "./01-hello-world.js";

describe("01-hello-world", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("outputs 'Hello, World!'", async () => {
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("Hello, World!");
  });

  it("shows help with --help", async () => {
    const result = await runCommand(command, ["--help"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("hello");
    expect(output).toContain("Hello Worldを表示するシンプルなコマンド");
  });
});
