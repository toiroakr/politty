import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripMarkers, verifyMigration } from "../src/verify.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf-8");

describe("stripMarkers", () => {
  it("removes every politty marker line", () => {
    const out = stripMarkers(read("fixtures/integration/README.old.md"));
    expect(out).not.toContain("<!-- politty:");
    expect(out).toContain("# init");
  });
});

describe("verifyMigration", () => {
  it("accepts an OLD->NEW transformation that only changes markers", () => {
    const oldMd = read("fixtures/integration/README.old.md");
    const newMd = read("fixtures/integration/README.expected.md");
    const result = verifyMigration(oldMd, newMd);
    expect(result.ok).toBe(true);
    expect(result.drift).toEqual([]);
  });

  it("reports content drift as non-marker differences", () => {
    const oldMd = read("fixtures/integration/README.old.md");
    const newMd = read("fixtures/integration/README.expected.md").replace(
      "Initialize a new project",
      "Initialize a NEW project",
    );
    const result = verifyMigration(oldMd, newMd);
    expect(result.ok).toBe(false);
    expect(result.drift.length).toBeGreaterThan(0);
  });
});
