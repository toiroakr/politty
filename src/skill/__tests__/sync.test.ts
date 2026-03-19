import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanInstalledSkills, scanSourceDirs } from "../scanner.js";
import { syncSkills } from "../sync.js";

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `politty-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkillMd(
  dir: string,
  name: string,
  opts: { description?: string; package?: string; body?: string },
): void {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const lines = [`name: ${name}`, `description: ${opts.description ?? `${name} skill`}`];
  if (opts.package) lines.push(`package: "${opts.package}"`);
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\n${lines.join("\n")}\n---\n${opts.body ?? `# ${name}\n`}`,
  );
}

describe("syncSkills", () => {
  let sourceDir: string;
  let installDir: string;

  beforeEach(() => {
    sourceDir = createTempDir();
    installDir = createTempDir();
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(installDir, { recursive: true, force: true });
  });

  it("should install new skills", () => {
    writeSkillMd(sourceDir, "commit", { package: "@my/skills" });
    writeSkillMd(sourceDir, "review", { package: "@my/skills" });

    const source = scanSourceDirs([sourceDir]);
    const result = syncSkills(source, [], installDir);

    expect(result.installed).toHaveLength(2);
    expect(result.updated).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);

    // Verify files were copied
    expect(existsSync(join(installDir, "commit", "SKILL.md"))).toBe(true);
    expect(existsSync(join(installDir, "review", "SKILL.md"))).toBe(true);
  });

  it("should detect unchanged skills", () => {
    writeSkillMd(sourceDir, "commit", { package: "@my/skills" });

    const source = scanSourceDirs([sourceDir]);
    // First sync: install
    syncSkills(source, [], installDir);

    // Second sync: should be unchanged
    const installed = scanInstalledSkills(installDir);
    const result = syncSkills(source, installed, installDir);

    expect(result.installed).toHaveLength(0);
    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0]!.frontmatter.name).toBe("commit");
  });

  it("should detect updated skills", () => {
    writeSkillMd(sourceDir, "commit", { package: "@my/skills", body: "# v1\n" });

    const source1 = scanSourceDirs([sourceDir]);
    syncSkills(source1, [], installDir);

    // Update source
    writeSkillMd(sourceDir, "commit", { package: "@my/skills", body: "# v2 with changes\n" });

    const source2 = scanSourceDirs([sourceDir]);
    const installed = scanInstalledSkills(installDir);
    const result = syncSkills(source2, installed, installDir);

    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]!.frontmatter.name).toBe("commit");

    // Verify content was updated
    const content = readFileSync(join(installDir, "commit", "SKILL.md"), "utf-8");
    expect(content).toContain("v2 with changes");
  });

  it("should detect removed skills by package", () => {
    // Install two skills from the same package
    writeSkillMd(sourceDir, "commit", { package: "@my/skills" });
    writeSkillMd(sourceDir, "review", { package: "@my/skills" });

    const source1 = scanSourceDirs([sourceDir]);
    syncSkills(source1, [], installDir);

    // Remove 'review' from source
    rmSync(join(sourceDir, "review"), { recursive: true, force: true });

    const source2 = scanSourceDirs([sourceDir]);
    const installed = scanInstalledSkills(installDir);
    const result = syncSkills(source2, installed, installDir);

    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]!.frontmatter.name).toBe("review");

    // Verify the file was deleted
    expect(existsSync(join(installDir, "review"))).toBe(false);
    // But commit should remain
    expect(existsSync(join(installDir, "commit", "SKILL.md"))).toBe(true);
  });

  it("should not remove skills without package field", () => {
    // Install skill without package
    writeSkillMd(sourceDir, "custom", {});

    const source1 = scanSourceDirs([sourceDir]);
    syncSkills(source1, [], installDir);

    // Now sync with empty source — custom has no package so should not be removed
    const installed = scanInstalledSkills(installDir);
    const result = syncSkills([], installed, installDir);

    expect(result.removed).toHaveLength(0);
    expect(existsSync(join(installDir, "custom", "SKILL.md"))).toBe(true);
  });

  it("should not remove skills from different packages", () => {
    // Install skills from two packages
    writeSkillMd(sourceDir, "commit", { package: "@pkg-a/skills" });

    const source1 = scanSourceDirs([sourceDir]);
    syncSkills(source1, [], installDir);

    // Manually add a skill from another package to install dir
    writeSkillMd(installDir, "other", { package: "@pkg-b/skills" });

    // Sync with only pkg-a source — should not touch pkg-b skills
    const installed = scanInstalledSkills(installDir);
    const result = syncSkills(source1, installed, installDir);

    expect(result.removed).toHaveLength(0);
    expect(existsSync(join(installDir, "other", "SKILL.md"))).toBe(true);
  });
});
