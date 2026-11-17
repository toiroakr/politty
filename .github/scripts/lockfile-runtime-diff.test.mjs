import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./lockfile-runtime-diff.mjs", import.meta.url));
const v13 = (dependencies, devDependencies = {}) => `---
lockfileVersion: '9.0'
importers: {}
---
{
  "lockfileVersion": "13.0",
  "projects": {
    "lib": {
      "dependencies": ${JSON.stringify(dependencies)},
      "devDependencies": ${JSON.stringify(devDependencies)},
    },
  },
}
`;

function runDiff(before, after) {
  const dir = mkdtempSync(join(tmpdir(), "lockfile-runtime-diff-"));
  try {
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "lib/package.json"), JSON.stringify({ name: "example" }));
    writeFileSync(join(dir, "before.yaml"), before);
    writeFileSync(join(dir, "after.yaml"), after);
    const result = spawnSync(
      process.execPath,
      [script, "--before", "before.yaml", "--after", "after.yaml"],
      { cwd: dir, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("detects runtime dependency updates in v13 project documents", () => {
  assert.match(
    runDiff(v13({ example: "1.0.0" }), v13({ example: "2.0.0" })),
    /Runtime dependency changes detected in: example/,
  );
  assert.match(
    runDiff(
      v13({ example: "1.0.0" }, { tool: "1.0.0" }),
      v13({ example: "1.0.0" }, { tool: "2.0.0" }),
    ),
    /No runtime dependency changes/,
  );
});

test("does not report unchanged dependencies when migrating from v9 to v13", () => {
  const before = `---
lockfileVersion: '9.0'
importers:
  .:
    packageManagerDependencies: {}
---
lockfileVersion: '9.0'
importers:
  lib:
    dependencies:
      example:
        specifier: ^1.0.0
        version: 1.2.0
`;
  assert.match(
    runDiff(before, v13({ example: { specifier: "^1.0.0", version: "1.2.0" } })),
    /No runtime dependency changes/,
  );
  assert.match(
    runDiff(before, v13({ example: { specifier: "^1.0.0", version: "1.3.0" } })),
    /Runtime dependency changes detected in: example/,
  );
});

test("ignores added projects without runtime dependencies", () => {
  const before = `{"lockfileVersion":"13.0","projects":{}}`;
  assert.match(
    runDiff(before, v13(undefined, { tool: "1.0.0" }).replace('"dependencies": undefined,', "")),
    /No runtime dependency changes/,
  );
});

test("detects runtime updates when lockfiles have CRLF line endings", () => {
  assert.match(
    runDiff(
      v13({ example: "1.0.0" }).replaceAll("\n", "\r\n"),
      v13({ example: "2.0.0" }).replaceAll("\n", "\r\n"),
    ),
    /Runtime dependency changes detected in: example/,
  );
});

test("detects resolved catalog updates across lockfile formats", () => {
  const before = `lockfileVersion: '9.0'
importers:
  lib:
    dependencies:
      example:
        specifier: catalog:
        version: 1.0.0
`;
  const after = v13({ example: "catalog:" }).replace(
    '"projects": {',
    '"settings": { "catalogs": { "default": { "example": "2.0.0" } } }, "projects": {',
  );
  assert.match(
    runDiff(before, after.replace('"example": "2.0.0"', '"example": "1.0.0"')),
    /No runtime dependency changes/,
  );
  assert.match(runDiff(before, after), /Runtime dependency changes detected in: example/);
});

test("detects resolved catalog updates between v13 lockfiles", () => {
  const after = v13({ example: "catalog:" }).replace(
    '"projects": {',
    '"settings": { "catalogs": { "default": { "example": "2.0.0" } } }, "projects": {',
  );
  const before = after.replace('"example": "2.0.0"', '"example": "1.0.0"');
  assert.match(runDiff(before, after), /Runtime dependency changes detected in: example/);
});

test("detects catalog range updates when the resolved version stays unchanged", () => {
  const before = v13({ example: "catalog:" }).replace(
    '"projects": {',
    '"settings": { "catalogs": { "default": { "example": { "specifier": "^1.0.0", "version": "1.2.0" } } } }, "projects": {',
  );
  const after = before.replace('"specifier": "^1.0.0"', '"specifier": "^1.1.0"');
  assert.match(runDiff(before, after), /Runtime dependency changes detected in: example/);
});

test("detects catalog range changes during a v9 to v13 migration", () => {
  const before = `lockfileVersion: '9.0'
catalogs:
  default:
    example:
      specifier: ^1.0.0
      version: 1.2.0
importers:
  lib:
    dependencies:
      example:
        specifier: catalog:
        version: 1.2.0
`;
  const same = v13({ example: "catalog:" }).replace(
    '"projects": {',
    '"settings": { "catalogs": { "default": { "example": { "specifier": "^1.0.0", "version": "1.2.0" } } } }, "projects": {',
  );
  assert.match(runDiff(before, same), /No runtime dependency changes/);
  const changed = same.replace('"specifier": "^1.0.0"', '"specifier": "^1.1.0"');
  assert.match(runDiff(before, changed), /Runtime dependency changes detected in: example/);
});

test("detects catalog range changes between v9 lockfiles", () => {
  const before = `lockfileVersion: '9.0'
catalogs:
  default:
    example:
      specifier: ^1.0.0
      version: 1.2.0
importers:
  lib:
    dependencies:
      example:
        specifier: catalog:
        version: 1.2.0
`;
  const after = before.replace("specifier: ^1.0.0", "specifier: ^1.1.0");
  assert.match(runDiff(before, after), /Runtime dependency changes detected in: example/);
});
