import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSkillListCommand } from "../commands.js";

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `politty-skill-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("createSkillListCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should output empty JSON array when no skills found with --json", () => {
    const command = createSkillListCommand({ sourceDir: tempDir });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      command.run!({ json: true });
      expect(consoleSpy).toHaveBeenCalledWith("[]");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should output JSON array with skills when --json is used", () => {
    writeSkillMd(tempDir, "commit", {
      name: "commit",
      description: "Commit skill",
      package: "@my-agent/skills",
    });

    const command = createSkillListCommand({ sourceDir: tempDir });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      command.run!({ json: true });
      expect(consoleSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output).toHaveLength(1);
      expect(output[0].name).toBe("commit");
      expect(output[0].description).toBe("Commit skill");
      expect(output[0].package).toBe("@my-agent/skills");
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
