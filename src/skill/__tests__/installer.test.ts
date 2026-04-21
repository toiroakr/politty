import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkill, readInstalledOwnership, uninstallSkill } from "../installer.js";
import type { DiscoveredSkill } from "../types.js";

const OWNERSHIP = "politty-test:my-agent";

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
  const raw = `---\nname: ${name}\ndescription: Test skill\n---\n# ${name}\n`;
  writeFileSync(join(skillDir, "SKILL.md"), raw);
  return {
    frontmatter: { name, description: "Test skill" },
    sourcePath: skillDir,
    rawContent: raw,
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

    installSkill(skill, OWNERSHIP, projectDir);

    const canonicalPath = join(projectDir, ".agents/skills/commit/SKILL.md");
    expect(existsSync(canonicalPath)).toBe(true);
    expect(readFileSync(canonicalPath, "utf-8")).toContain("name: commit");
  });

  it("should stamp metadata.politty-cli on the installed SKILL.md", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, OWNERSHIP, projectDir);

    expect(readInstalledOwnership("commit", projectDir)).toBe(OWNERSHIP);
  });

  it("should overwrite an existing politty-cli stamp rather than duplicating it", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    writeFileSync(
      join(skill.sourcePath, "SKILL.md"),
      `---\nname: commit\ndescription: Test skill\nmetadata:\n  politty-cli: "stale:other"\n---\nbody\n`,
    );

    installSkill(skill, OWNERSHIP, projectDir);

    const content = readFileSync(join(projectDir, ".agents/skills/commit/SKILL.md"), "utf-8");
    const matches = content.match(/politty-cli:/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
    expect(readInstalledOwnership("commit", projectDir)).toBe(OWNERSHIP);
  });

  it("should stamp correctly when source SKILL.md uses flow-style metadata", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    writeFileSync(
      join(skill.sourcePath, "SKILL.md"),
      `---\nname: commit\ndescription: Flow metadata\nmetadata: { owner: alice }\n---\nbody\n`,
    );

    installSkill(skill, OWNERSHIP, projectDir);

    expect(readInstalledOwnership("commit", projectDir)).toBe(OWNERSHIP);
    const content = readFileSync(join(projectDir, ".agents/skills/commit/SKILL.md"), "utf-8");
    // Flow style must be rewritten to block style; the pre-existing key must survive.
    expect(content).toContain("metadata:");
    expect(content).toContain("owner:");
    expect(content).toMatch(/politty-cli:/);
  });

  it("should handle empty flow-style metadata", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    writeFileSync(
      join(skill.sourcePath, "SKILL.md"),
      `---\nname: commit\ndescription: Empty flow metadata\nmetadata: {}\n---\nbody\n`,
    );

    installSkill(skill, OWNERSHIP, projectDir);

    expect(readInstalledOwnership("commit", projectDir)).toBe(OWNERSHIP);
  });

  it("should not misread a block-style metadata line with a trailing comment as flow style", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    writeFileSync(
      join(skill.sourcePath, "SKILL.md"),
      `---\nname: commit\ndescription: Block style with comment\nmetadata: # inline note\n  owner: alice\n---\nbody\n`,
    );

    installSkill(skill, OWNERSHIP, projectDir);

    expect(readInstalledOwnership("commit", projectDir)).toBe(OWNERSHIP);
    const content = readFileSync(join(projectDir, ".agents/skills/commit/SKILL.md"), "utf-8");
    // The pre-existing block child must survive. If we had mistaken the
    // comment for a flow map, parseInlineMap would have returned `{}` and
    // the rebuild would have dropped `owner: alice`.
    expect(content).toContain("owner: alice");
    expect(content).toMatch(/politty-cli: /);
  });

  it("should preserve existing child indent when inserting into a 4-space metadata block", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    writeFileSync(
      join(skill.sourcePath, "SKILL.md"),
      `---\nname: commit\ndescription: 4-space indented metadata\nmetadata:\n    owner: alice\n---\nbody\n`,
    );

    installSkill(skill, OWNERSHIP, projectDir);

    expect(readInstalledOwnership("commit", projectDir)).toBe(OWNERSHIP);
    const content = readFileSync(join(projectDir, ".agents/skills/commit/SKILL.md"), "utf-8");
    // Both the pre-existing child and the newly-inserted politty-cli line
    // must share the same 4-space indent, or YAML will close the mapping
    // at the shallower line and fail to parse.
    expect(content).toMatch(/\n {4}owner: alice\n/);
    expect(content).toMatch(/\n {4}politty-cli: /);
  });

  it("should populate .claude/skills/<name>/ via symlink on Unix, accept copy fallback on Windows", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, OWNERSHIP, projectDir);

    const claudePath = join(projectDir, ".claude/skills/commit");
    expect(existsSync(claudePath)).toBe(true);
    expect(readFileSync(join(claudePath, "SKILL.md"), "utf-8")).toContain("name: commit");
    const stat = lstatSync(claudePath);
    if (process.platform === "win32") {
      // Windows without Developer Mode/admin cannot create symlinks — either
      // outcome is acceptable. Permissive assertion here keeps the same
      // branch covered but lets the production code fall back to cpSync.
      expect(stat.isSymbolicLink() || stat.isDirectory()).toBe(true);
    } else {
      // On Unix, `symlinkSync` is expected to succeed. If this regresses
      // into the cpSync fallback path, updates to the canonical directory
      // would stop propagating to `.claude/skills/<name>` — catch it here.
      expect(stat.isSymbolicLink()).toBe(true);
    }
  });

  it("should overwrite an existing installation atomically", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, OWNERSHIP, projectDir);

    writeFileSync(
      join(skill.sourcePath, "SKILL.md"),
      "---\nname: commit\ndescription: Updated\n---\n",
    );
    installSkill(skill, OWNERSHIP, projectDir);

    const content = readFileSync(join(projectDir, ".agents/skills/commit/SKILL.md"), "utf-8");
    expect(content).toContain("Updated");
  });

  it("should remove stale files from previous installs", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    writeFileSync(join(skill.sourcePath, "old-helper.md"), "# old");

    installSkill(skill, OWNERSHIP, projectDir);
    expect(existsSync(join(projectDir, ".agents/skills/commit/old-helper.md"))).toBe(true);

    rmSync(join(skill.sourcePath, "old-helper.md"));
    installSkill(skill, OWNERSHIP, projectDir);

    expect(existsSync(join(projectDir, ".agents/skills/commit/old-helper.md"))).toBe(false);
  });

  it("should not leave a staging directory behind on success", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, OWNERSHIP, projectDir);

    const parent = join(projectDir, ".agents/skills");
    const leftovers = readdirSync(parent).filter((n) => n.startsWith(".install-"));
    expect(leftovers).toEqual([]);
  });

  it("should refuse to install when SKILL.md is a symlink in the source tree", () => {
    const skillDir = join(sourceDir, "attacker");
    mkdirSync(skillDir, { recursive: true });
    // Put real content somewhere outside the skill dir, then make SKILL.md
    // a symlink pointing at it. The install-time symlink filter drops the
    // link during cpSync, so the staged skill ends up without SKILL.md.
    const realTarget = join(sourceDir, "decoy.md");
    writeFileSync(realTarget, "---\nname: attacker\ndescription: evil\n---\nbody\n");
    symlinkSync(realTarget, join(skillDir, "SKILL.md"), "file");

    const skill: DiscoveredSkill = {
      frontmatter: { name: "attacker", description: "evil" },
      sourcePath: skillDir,
      rawContent: "",
    };

    expect(() => installSkill(skill, OWNERSHIP, projectDir)).toThrow(/no SKILL\.md/);
  });

  it("should reject unsafe skill names", () => {
    const skill: DiscoveredSkill = {
      frontmatter: { name: "../escape", description: "bad" },
      sourcePath: sourceDir,
      rawContent: "",
    };

    expect(() => installSkill(skill, OWNERSHIP, projectDir)).toThrow(/Invalid skill name/);
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
    installSkill(skill, OWNERSHIP, projectDir);

    uninstallSkill("commit", projectDir);

    expect(existsSync(join(projectDir, ".agents/skills/commit"))).toBe(false);
    expect(existsSync(join(projectDir, ".claude/skills/commit"))).toBe(false);
  });

  it("should not throw when skill is not installed", () => {
    expect(() => uninstallSkill("nonexistent", projectDir)).not.toThrow();
  });
});

describe("readInstalledOwnership", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = createTempDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should return null when the skill is not installed", () => {
    expect(readInstalledOwnership("nobody", projectDir)).toBeNull();
  });

  it("should return null when metadata.politty-cli is absent", () => {
    const skillDir = join(projectDir, ".agents/skills/noowner");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: noowner\ndescription: ok\n---\n");

    expect(readInstalledOwnership("noowner", projectDir)).toBeNull();
  });
});
