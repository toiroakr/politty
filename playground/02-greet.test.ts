import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { command } from "./02-greet.js";

describe("02-greet", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("greets with default greeting", async () => {
    const result = await runCommand(command, ["World"]);

    expect(result.exitCode).toBe(0);
    expect(result.result).toBe("Hello, World!");
    expect(consoleSpy).toHaveBeenCalledWith("Hello, World!");
  });

  it("greets with custom greeting using --greeting", async () => {
    const result = await runCommand(command, ["World", "--greeting", "Hi"]);

    expect(result.exitCode).toBe(0);
    expect(result.result).toBe("Hi, World!");
  });

  it("greets with custom greeting using -g alias", async () => {
    const result = await runCommand(command, ["World", "-g", "Howdy"]);

    expect(result.exitCode).toBe(0);
    expect(result.result).toBe("Howdy, World!");
  });

  it("outputs in uppercase with --loud", async () => {
    const result = await runCommand(command, ["World", "--loud"]);

    expect(result.exitCode).toBe(0);
    expect(result.result).toBe("HELLO, WORLD!");
  });

  it("outputs in uppercase with -l alias", async () => {
    const result = await runCommand(command, ["World", "-l"]);

    expect(result.exitCode).toBe(0);
    expect(result.result).toBe("HELLO, WORLD!");
  });

  it("combines custom greeting and loud mode", async () => {
    const result = await runCommand(command, ["World", "-g", "Hi", "-l"]);

    expect(result.exitCode).toBe(0);
    expect(result.result).toBe("HI, WORLD!");
  });

  it("fails when name is not provided", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });
});
