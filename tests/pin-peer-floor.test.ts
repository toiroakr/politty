import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it.each([false, true])(
  "pins a peer floor twice with an existing override mapping: %s",
  (existing) => {
    const dir = mkdtempSync(join(tmpdir(), "politty-peer-floor-"));
    const script = resolve(".github/scripts/pin-peer-floor.mjs");
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          private: true,
          packageManager: JSON.parse(readFileSync("package.json", "utf8")).packageManager,
        }),
      );
      writeFileSync(
        join(dir, "pnpm-workspace.yaml"),
        'packages:\n  - "packages/*"\n' +
          (existing ? '\noverrides:\n  "editorconfig>minimatch": "^11.0.5"\n' : ""),
      );
      for (const version of ["4.3.0", "4.2.1"]) {
        execFileSync(process.execPath, [script, "zod", version], { cwd: dir });
      }
      const workspace = readFileSync(join(dir, "pnpm-workspace.yaml"), "utf8");
      expect(workspace.match(/^overrides:/gm)).toHaveLength(1);
      expect(workspace).toContain("packages/*");
      const overrides = JSON.parse(
        execFileSync("pnpm", ["config", "get", "overrides", "--json", "--location", "project"], {
          cwd: dir,
          encoding: "utf8",
        }),
      );
      expect(overrides).toEqual({
        ...(existing ? { "editorconfig>minimatch": "^11.0.5" } : {}),
        zod: "4.2.1",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
