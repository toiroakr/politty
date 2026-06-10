import { describe, expect, it } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { main } from "./index.js";

describe("19-xor-types", () => {
  describe("token auth (first xor option)", () => {
    it("authenticates with token", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(main, ["--token", "abc123"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Authenticated with token:", "abc123");
    });
  });

  describe("credentials auth (second xor option)", () => {
    it("authenticates with username and password", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(main, ["--username", "admin", "--password", "secret"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Authenticated with credentials:");
      expect(console).toHaveBeenCalledWith("  Username:", "admin");
      expect(console).toHaveBeenCalledWith("  Password:", "secret");
    });
  });

  describe("help", () => {
    it("shows help with xor options", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(main, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("auth-demo");
      expect(output).toContain("--token");
      expect(output).toContain("--username");
      expect(output).toContain("--password");
    });
  });

  it("succeeds with anonymous auth (no options)", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(main, []);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Authenticated anonymously");
  });

  it("documentation", async () => {
    using _console = spyOnConsoleLog();
    await assertDocMatch({
      command: main,
      files: { "playground/19-xor-types/README.md": { commands: [""] } },
      formatter: mdFormatter,
    });
  });
});
