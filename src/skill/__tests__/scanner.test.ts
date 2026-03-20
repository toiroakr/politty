import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanSourceDirs } from "../scanner.js";

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `politty-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkillMd(dir: string, name: string, frontmatter: Record<string, string>): void {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v.includes(" ") || v.startsWith("@") ? `"${v}"` : v}`)
    .join("\n");
  writeFileSync(join(skillDir, "SKILL.md"), `---\n${fm}\n---\n# ${name} skill\n`);
}

describe("scanSourceDirs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should discover skills from a source directory", () => {
    writeSkillMd(tempDir, "commit", {
      name: "commit",
      description: "Commit skill",
      package: "@my-agent/skills",
    });
    writeSkillMd(tempDir, "review-pr", {
      name: "review-pr",
      description: "PR review skill",
      package: "@my-agent/skills",
    });

    const skills = scanSourceDirs([tempDir]);

    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.frontmatter.name).sort()).toEqual(["commit", "review-pr"]);
  });

  it("should skip directories without SKILL.md", () => {
    writeSkillMd(tempDir, "commit", {
      name: "commit",
      description: "Commit skill",
    });
    mkdirSync(join(tempDir, "not-a-skill"), { recursive: true });
    writeFileSync(join(tempDir, "not-a-skill", "README.md"), "# Not a skill");

    const skills = scanSourceDirs([tempDir]);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.frontmatter.name).toBe("commit");
  });

  it("should skip invalid SKILL.md files", () => {
    const skillDir = join(tempDir, "invalid");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: invalid\n---\n# Missing description");

    const skills = scanSourceDirs([tempDir]);

    expect(skills).toHaveLength(0);
  });

  it("should deduplicate skills by name across source dirs", () => {
    const dir1 = join(tempDir, "source1");
    const dir2 = join(tempDir, "source2");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    writeSkillMd(dir1, "commit", {
      name: "commit",
      description: "Commit skill v1",
    });
    writeSkillMd(dir2, "commit", {
      name: "commit",
      description: "Commit skill v2",
    });

    const skills = scanSourceDirs([dir1, dir2]);

    expect(skills).toHaveLength(1);
    // First source wins
    expect(skills[0]!.frontmatter.description).toBe("Commit skill v1");
  });

  it("should handle non-existent source directories", () => {
    const skills = scanSourceDirs(["/nonexistent/path"]);

    expect(skills).toHaveLength(0);
  });

  it("should handle multiple source directories", () => {
    const dir1 = join(tempDir, "source1");
    const dir2 = join(tempDir, "source2");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    writeSkillMd(dir1, "commit", {
      name: "commit",
      description: "Commit skill",
    });
    writeSkillMd(dir2, "review", {
      name: "review",
      description: "Review skill",
    });

    const skills = scanSourceDirs([dir1, dir2]);

    expect(skills).toHaveLength(2);
  });

  it("should handle a single-skill source directory (SKILL.md at root)", () => {
    const singleSkillDir = join(tempDir, "single");
    mkdirSync(singleSkillDir, { recursive: true });
    writeFileSync(
      join(singleSkillDir, "SKILL.md"),
      "---\nname: single\ndescription: A single skill\n---\n# Single\n",
    );

    const skills = scanSourceDirs([singleSkillDir]);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.frontmatter.name).toBe("single");
  });
});
