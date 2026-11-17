import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";

it("preserves existing workspace overrides when pinning a peer floor twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "politty-peer-floor-"));
  const script = resolve(".github/scripts/pin-peer-floor.mjs");
  try {
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n\noverrides:\n  "editorconfig>minimatch": "^11.0.5"\n',
    );
    for (let i = 0; i < 2; i++) {
      execFileSync(process.execPath, [script, "zod", "4.2.1"], { cwd: dir });
    }
    const workspace = readFileSync(join(dir, "pnpm-workspace.yaml"), "utf8");
    expect(workspace.match(/^overrides:/gm)).toHaveLength(1);
    expect(parse(workspace)).toEqual({
      packages: ["packages/*"],
      overrides: { "editorconfig>minimatch": "^11.0.5", zod: "4.2.1" },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
