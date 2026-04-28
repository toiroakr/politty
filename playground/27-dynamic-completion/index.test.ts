import { describe, expect, it, vi } from "vitest";
import { runCommand } from "../../src/index.js";
import { cli } from "./index.js";

async function complete(argv: string[]): Promise<string[]> {
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await runCommand(cli, ["__complete", "--shell", "bash", "--", ...argv]);
  const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
  consoleSpy.mockRestore();
  // Drop the trailing `:directive` and any `@meta:` sentinel lines.
  return output.split("\n").filter((l) => !l.startsWith(":") && !l.startsWith("@") && l.length > 0);
}

describe("playground/27-dynamic-completion", () => {
  it("returns empty candidates when endpoint not yet typed", async () => {
    const lines = await complete(["api", "--field", ""]);
    expect(lines).toEqual([]);
  });

  it("suggests fields for GetApplication", async () => {
    const lines = await complete(["api", "GetApplication", "--field", ""]);
    expect(lines).toContain("workspaceId=");
    expect(lines).toContain("applicationName=");
  });

  it("excludes already-used keys (previousValues de-dup)", async () => {
    const lines = await complete(["api", "CreateApplication", "-f", "cors=https://a", "-f", ""]);
    expect(lines).not.toContain("cors=");
    expect(lines).toContain("workspaceId=");
    expect(lines).toContain("applicationName=");
    expect(lines).toContain("disableIntrospection=");
  });

  it("supports inline --field=<prefix> filtering", async () => {
    // The bash formatter prepends the inline prefix back to each candidate
    // and filters by the part after `=`. With prefix "appli", only
    // `applicationName=` should remain.
    const lines = await complete(["api", "GetApplication", "--field=appli"]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.startsWith("--field=applicationName"))).toBe(true);
  });
});
