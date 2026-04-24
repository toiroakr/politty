import type * as FS from "node:fs";
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    `politty-auto-fallback-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("installSkill auto-mode fallback", () => {
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

  it("should fall back to copy when symlinkSync throws in 'auto' mode (default)", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    // Default is "auto" — mocked symlinkSync always fails, so every slot
    // must materialize as a real directory (a copy).
    installSkill(skill, projectDir);

    const canonicalPath = join(projectDir, ".agents/skills/commit");
    expect(lstatSync(canonicalPath).isDirectory()).toBe(true);
    expect(lstatSync(canonicalPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(canonicalPath, "SKILL.md"), "utf-8")).toContain("name: commit");

    const claudePath = join(projectDir, ".claude/skills/commit");
    expect(lstatSync(claudePath).isDirectory()).toBe(true);
    expect(lstatSync(claudePath).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(claudePath, "SKILL.md"), "utf-8")).toContain("name: commit");
  });

  it("should throw in 'symlink' mode when symlinkSync fails", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    expect(() => installSkill(skill, projectDir, { mode: "symlink" })).toThrow(/EPERM/);
  });

  it("should succeed in 'copy' mode regardless of symlinkSync availability", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, projectDir, { mode: "copy" });

    const canonicalPath = join(projectDir, ".agents/skills/commit");
    expect(lstatSync(canonicalPath).isDirectory()).toBe(true);
    expect(lstatSync(canonicalPath).isSymbolicLink()).toBe(false);
  });
});
