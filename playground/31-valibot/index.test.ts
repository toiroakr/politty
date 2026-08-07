import { describe, expect, it } from "vitest";
import { assertDocMatch } from "../../packages/valibot/src/docs.js";
import { runCommand } from "../../packages/valibot/src/index.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

describe("31-valibot", () => {
  it("parses a positional, a coerced number, and an enum default", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["config.json", "-p", "8080"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("[info] serving config.json on port 8080");
  });

  it("accepts the enum value and the negated boolean", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, [
      "config.json",
      "--port",
      "3000",
      "--level",
      "debug",
      "--no-color",
    ]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("debug serving config.json on port 3000");
  });

  it("reports valibot validation errors for an out-of-range port", async () => {
    const result = await runCommand(command, ["config.json", "-p", "99999"]);

    expect(result.success).toBe(false);
    expect(String(result.error?.message)).toContain("port");
  });

  it("rejects an enum value outside the picklist", async () => {
    const result = await runCommand(command, ["config.json", "-p", "1", "--level", "trace"]);

    expect(result.success).toBe(false);
    expect(String(result.error?.message)).toContain('"debug" | "info" | "warn"');
  });

  it("documentation", async () => {
    using _console = spyOnConsoleLog();
    await assertDocMatch({
      command,
      files: { "playground/31-valibot/README.md": [""] },
      formatter: mdFormatter,
    });
  });
});
