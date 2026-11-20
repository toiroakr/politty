import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDoc } from "../../packages/politty/src/standard-docs.js";
import { runCommand } from "../../packages/politty/src/standard.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

describe("34-standard", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("parses a positional and coerced port and applies defaults", async () => {
    vi.stubEnv("SERVE_LOG_LEVEL", undefined);
    using console = spyOnConsoleLog();

    expect(await runCommand(command, ["config.json", "-p", "8080"])).toMatchObject({
      success: true,
      exitCode: 0,
    });
    expect(console).toHaveBeenCalledWith("[info] serving config.json on port 8080");
  });

  it("uses the environment as a fallback and accepts CLI overrides and negation", async () => {
    vi.stubEnv("SERVE_LOG_LEVEL", "warn");
    using console = spyOnConsoleLog();

    expect(await runCommand(command, ["config.json", "-p", "3000", "--no-color"])).toMatchObject({
      success: true,
    });
    expect(console).toHaveBeenLastCalledWith("warn serving config.json on port 3000");

    expect(await runCommand(command, ["config.json", "-p", "3000", "-L", "debug"])).toMatchObject({
      success: true,
    });
    expect(console).toHaveBeenLastCalledWith("[debug] serving config.json on port 3000");
  });

  it.each([
    { argv: ["config.json", "-p", "99999"], error: "port" },
    { argv: ["config.json", "-p", "8080.5"], error: "port" },
    { argv: ["config.json", "-p", "8080", "-L", "trace"], error: "level" },
    { argv: ["config.json", "-p", "8080", "--unknown"], error: "Unknown flags: unknown" },
  ])("rejects invalid CLI input for $error", async ({ argv, error }) => {
    vi.stubEnv("SERVE_LOG_LEVEL", undefined);
    using console = spyOnConsoleLog();

    expect(await runCommand(command, argv)).toMatchObject({
      success: false,
      error: { message: expect.stringContaining(error) },
    });
    expect(console).not.toHaveBeenCalled();
  });

  it("documentation", async () => {
    using _console = spyOnConsoleLog();
    const result = await generateDoc({
      command,
      files: { "playground/34-standard/README.md": [""] },
      formatter: mdFormatter,
    });
    expect(result.success, result.error).toBe(true);
  });
});
