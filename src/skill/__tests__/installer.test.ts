import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkill, uninstallSkill } from "../installer.js";
import type { DiscoveredSkill } from "../types.js";

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `politty-installer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createSkillFixture(dir: string, name: string): DiscoveredSkill {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill\n---\n# ${name}\n`,
  );
  return {
    frontmatter: { name, description: "Test skill" },
    sourcePath: skillDir,
    rawContent: `---\nname: ${name}\ndescription: Test skill\n---\n# ${name}\n`,
  };
}

describe("installSkill", () => {
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

  it("should copy skill to .agents/skills/<name>/", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, projectDir);

    const canonicalPath = join(projectDir, ".agents/skills/commit/SKILL.md");
    expect(existsSync(canonicalPath)).toBe(true);
    expect(readFileSync(canonicalPath, "utf-8")).toContain("name: commit");
  });

  it("should create symlink in .claude/skills/<name>/", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, projectDir);

    const claudePath = join(projectDir, ".claude/skills/commit");
    expect(existsSync(claudePath)).toBe(true);

    const stat = lstatSync(claudePath);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it("should overwrite existing installation", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, projectDir);

    // Modify source and reinstall
    writeFileSync(
      join(skill.sourcePath, "SKILL.md"),
      "---\nname: commit\ndescription: Updated\n---\n",
    );
    installSkill(skill, projectDir);

    const content = readFileSync(join(projectDir, ".agents/skills/commit/SKILL.md"), "utf-8");
    expect(content).toContain("Updated");
  });
});

describe("uninstallSkill", () => {
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

  it("should remove skill from all directories", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    installSkill(skill, projectDir);

    uninstallSkill("commit", projectDir);

    expect(existsSync(join(projectDir, ".agents/skills/commit"))).toBe(false);
    expect(existsSync(join(projectDir, ".claude/skills/commit"))).toBe(false);
  });

  it("should not throw when skill is not installed", () => {
    expect(() => uninstallSkill("nonexistent", projectDir)).not.toThrow();
  });
});
