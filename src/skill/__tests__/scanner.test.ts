import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    });
    writeSkillMd(tempDir, "review-pr", {
      name: "review-pr",
      description: "PR review skill",
    });

    const { skills, errors } = scanSourceDir(tempDir);

    expect(errors).toEqual([]);
    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.frontmatter.name)).toEqual(["commit", "review-pr"]);
  });

  it("should skip directories without SKILL.md", () => {
    writeSkillMd(tempDir, "commit", {
      name: "commit",
      description: "Commit skill",
    });
    mkdirSync(join(tempDir, "not-a-skill"), { recursive: true });
    writeFileSync(join(tempDir, "not-a-skill", "README.md"), "# Not a skill");

    const { skills } = scanSourceDir(tempDir);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.frontmatter.name).toBe("commit");
  });

  it("should surface a parse-failed error for invalid SKILL.md", () => {
    const skillDir = join(tempDir, "invalid");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: invalid\n---\n# Missing description");

    const { skills, errors } = scanSourceDir(tempDir);

    expect(skills).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toBe("parse-failed");
    expect(errors[0]!.path).toBe(skillDir);
  });

  it("should surface a name-mismatch error when frontmatter name != dir", () => {
    const skillDir = join(tempDir, "renamed");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: original\ndescription: ok\n---\nbody\n");

    const { skills, errors } = scanSourceDir(tempDir);

    expect(skills).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toBe("name-mismatch");
  });

  it("should skip symlinked subdirectories", () => {
    const realSkillRoot = createTempDir();
    try {
      writeSkillMd(realSkillRoot, "external", {
        name: "external",
        description: "outside the tree",
      });
      symlinkSync(join(realSkillRoot, "external"), join(tempDir, "external"), "dir");

      const { skills } = scanSourceDir(tempDir);

      expect(skills).toHaveLength(0);
    } finally {
      rmSync(realSkillRoot, { recursive: true, force: true });
    }
  });

  it("should report missing-source for non-existent source directory", () => {
    const { skills, errors } = scanSourceDir("/nonexistent/path");

    expect(skills).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toBe("missing-source");
    expect(errors[0]!.path).toBe("/nonexistent/path");
  });

  it("should report missing-source when sourceDir is a file, not a directory", () => {
    const filePath = join(tempDir, "not-a-dir");
    writeFileSync(filePath, "");

    const { skills, errors } = scanSourceDir(filePath);

    expect(skills).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toBe("missing-source");
  });

  it("should handle a single-skill source directory (SKILL.md at root)", () => {
    const singleSkillDir = join(tempDir, "single");
    mkdirSync(singleSkillDir, { recursive: true });
    writeFileSync(
      join(singleSkillDir, "SKILL.md"),
      "---\nname: single\ndescription: A single skill\n---\n# Single\n",
    );

    const { skills } = scanSourceDir(singleSkillDir);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.frontmatter.name).toBe("single");
  });

  it("should reject a symlinked SKILL.md as a regular-file violation", () => {
    const realContentDir = createTempDir();
    try {
      const realMd = join(realContentDir, "real.md");
      writeFileSync(realMd, "---\nname: bogus\ndescription: malicious content\n---\n# payload\n");

      const skillDir = join(tempDir, "attacker");
      mkdirSync(skillDir, { recursive: true });
      symlinkSync(realMd, join(skillDir, "SKILL.md"), "file");

      const { skills, errors } = scanSourceDir(tempDir);

      expect(skills).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.reason).toBe("read-failed");
      expect(errors[0]!.message).toMatch(/not a regular file/);
    } finally {
      rmSync(realContentDir, { recursive: true, force: true });
    }
  });

  it("should not enforce dir-name match for single-skill sources", () => {
    const singleSkillDir = join(tempDir, "arbitrary-dirname-123");
    mkdirSync(singleSkillDir, { recursive: true });
    writeFileSync(join(singleSkillDir, "SKILL.md"), "---\nname: my-skill\ndescription: ok\n---\n");

    const { skills, errors } = scanSourceDir(singleSkillDir);

    expect(errors).toEqual([]);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.frontmatter.name).toBe("my-skill");
  });
});
