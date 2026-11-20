import { describe, expect, it } from "vitest";
import { runCommand } from "../../packages/standard/src/index.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { workspace } from "./workspace.js";

describe("34-standard workspace", () => {
  it.each([
    { argv: ["read", "--file", "config.json"], output: "config.json" },
    { argv: ["read", "--url", "https://example.com"], output: "https://example.com" },
    {
      argv: ["publish", "--destination", "preview", "--release-version", "2.0", "--dry-run"],
      output: "2.0 → preview (dry run)",
    },
    { argv: ["connect", "-p", "5432"], output: "localhost:5432" },
  ])("runs $argv", async ({ argv, output }) => {
    using console = spyOnConsoleLog();
    expect(await runCommand(workspace, argv)).toMatchObject({ success: true });
    expect(console).toHaveBeenCalledWith(output);
  });
});
