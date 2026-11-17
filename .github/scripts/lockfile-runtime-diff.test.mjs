import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./lockfile-runtime-diff.mjs", import.meta.url));

test("detects runtime dependency updates in v13 project documents", () => {
  const dir = mkdtempSync(join(tmpdir(), "lockfile-runtime-diff-"));
  try {
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "lib/package.json"), JSON.stringify({ name: "example" }));
    const lockfile = (version, devVersion) => `---
lockfileVersion: '9.0'
importers: {}
---
{
  "lockfileVersion": "13.0",
  "projects": {
    "lib": {
      "dependencies": { "example": "${version}", },
      "devDependencies": { "test-tool": "${devVersion}", },
    },
  },
}
`;
    writeFileSync(join(dir, "before.yaml"), lockfile("1.0.0", "1.0.0"));
    writeFileSync(join(dir, "after.yaml"), lockfile("2.0.0", "1.0.0"));
    const run = () =>
      spawnSync(process.execPath, [script, "--before", "before.yaml", "--after", "after.yaml"], {
        cwd: dir,
        encoding: "utf8",
      });
    const changed = run();
    assert.equal(changed.status, 0, changed.stderr);
    assert.match(changed.stdout, /Runtime dependency changes detected in: example/);
    writeFileSync(join(dir, "after.yaml"), lockfile("1.0.0", "2.0.0"));
    const devOnly = run();
    assert.equal(devOnly.status, 0, devOnly.stderr);
    assert.match(devOnly.stdout, /No runtime dependency changes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
