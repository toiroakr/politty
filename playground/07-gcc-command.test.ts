import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../tests/utils/console.js";
import { command } from "./07-gcc-command.js";

describe("07-gcc-command", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  it("compiles single source file", async () => {
    const result = await runCommand(command, ["-o", "app", "main.c"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Sources: main.c");
    expect(console).toHaveBeenCalledWith("  Output: app");
  });

  it("compiles multiple source files", async () => {
    const result = await runCommand(command, ["-o", "myprogram", "main.c", "util.c", "lib.c"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Sources: main.c, util.c, lib.c");
  });

  it("enables optimization with -O", async () => {
    const result = await runCommand(command, ["-o", "app", "-O", "main.c"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Optimization: enabled");
  });

  it("uses --output alias", async () => {
    const result = await runCommand(command, ["--output", "build/app", "src/a.c", "src/b.c"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Output: build/app");
  });

  it("fails when output is not provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, ["main.c"]);

    expect(result.exitCode).toBe(1);
  });

  it("fails when sources are not provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, ["-o", "app"]);

    expect(result.exitCode).toBe(1);
  });
});
