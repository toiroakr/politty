import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { command } from "./20-meta.js";

describe("20-meta", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("greets with positional name (via meta)", async () => {
    const result = await runCommand(command, ["World"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("Hello, World!");
  });

  it("greets with custom greeting using -g (via meta)", async () => {
    const result = await runCommand(command, ["World", "-g", "Hi"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("Hi, World!");
  });

  it("greets with custom greeting using --greeting (via meta)", async () => {
    const result = await runCommand(command, ["World", "--greeting", "Howdy"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("Howdy, World!");
  });

  it("shows help with meta-defined options", async () => {
    const result = await runCommand(command, ["--help"]);

    expect(result.exitCode).toBe(0);
    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("greet-meta");
    expect(output).toContain("<name>");
    expect(output).toContain("Greeting phrase (via meta)");
  });

  it("fails when name is not provided", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });
});
