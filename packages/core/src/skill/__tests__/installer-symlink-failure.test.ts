import type * as FS from "node:fs";
import { lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredSkill } from "../types.js";

// Named-import bindings in installer.ts are resolved at module load, so
// the only reliable way to force symlinkSync to fail is via vi.mock.
// Every other fs function we need behaves normally via importOriginal.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof FS>();
  return {
    ...actual,
    symlinkSync: vi.fn((..._args: unknown[]) => {
      const err = new Error("EPERM: operation not permitted, symlink") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    }),
  };
});

const { installSkill } = await import("../installer.js");

const OWNERSHIP = "politty-test:my-agent";

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `politty-symlink-failure-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createSkillFixture(dir: string, name: string): DiscoveredSkill {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const raw = `---\nname: ${name}\ndescription: Test skill\nmetadata:\n  politty-cli: "${OWNERSHIP}"\n---\n# ${name}\n`;
  writeFileSync(join(skillDir, "SKILL.md"), raw);
  return {
    frontmatter: {
      name,
      description: "Test skill",
      metadata: { "politty-cli": OWNERSHIP },
    },
    sourcePath: skillDir,
    rawContent: raw,
  };
}

describe("installSkill symlink-failure guidance", () => {
  let sourceDir: string;
  let projectDir: string;

  beforeEach(() => {
    sourceDir = createTempDir();
    projectDir = createTempDir();
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should throw with guidance to retry with mode 'copy' when symlinkSync fails", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    // Default mode is "symlink"; symlinkSync is mocked to always throw so
    // this exercises the Windows-without-Developer-Mode error path.
    expect(() => installSkill(skill, projectDir)).toThrow(/mode: "copy"/);
    expect(() => installSkill(skill, projectDir)).toThrow(/EPERM/);
  });

  it("should succeed in 'copy' mode regardless of symlinkSync availability", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, projectDir, { mode: "copy" });

    const canonicalPath = join(projectDir, ".agents/skills/commit");
    expect(lstatSync(canonicalPath).isDirectory()).toBe(true);
    expect(lstatSync(canonicalPath).isSymbolicLink()).toBe(false);
  });
});
