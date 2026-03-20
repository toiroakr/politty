import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanSourceDir } from "../scanner.js";

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

describe("scanSourceDir", () => {
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

    const skills = scanSourceDir(tempDir);

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

    const skills = scanSourceDir(tempDir);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.frontmatter.name).toBe("commit");
  });

  it("should skip invalid SKILL.md files", () => {
    const skillDir = join(tempDir, "invalid");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: invalid\n---\n# Missing description");

    const skills = scanSourceDir(tempDir);

    expect(skills).toHaveLength(0);
  });

  it("should handle non-existent source directory", () => {
    const skills = scanSourceDir("/nonexistent/path");

    expect(skills).toHaveLength(0);
  });

  it("should handle a single-skill source directory (SKILL.md at root)", () => {
    const singleSkillDir = join(tempDir, "single");
    mkdirSync(singleSkillDir, { recursive: true });
    writeFileSync(
      join(singleSkillDir, "SKILL.md"),
      "---\nname: single\ndescription: A single skill\n---\n# Single\n",
    );

    const skills = scanSourceDir(singleSkillDir);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.frontmatter.name).toBe("single");
  });
});
