import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSkillAddCommand,
  createSkillListCommand,
  createSkillRemoveCommand,
  createSkillSyncCommand,
} from "../commands.js";

vi.mock("../installer.js", () => ({
  installSkill: vi.fn(),
  uninstallSkill: vi.fn(),
}));

const { installSkill: mockedInstall, uninstallSkill: mockedUninstall } =
  await import("../installer.js");
const mockedInstallSkill = vi.mocked(mockedInstall);
const mockedUninstallSkill = vi.mocked(mockedUninstall);

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

describe("createSkillSyncCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mockedInstallSkill.mockReset();
    mockedUninstallSkill.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("should remove and reinstall all skills", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillSyncCommand({ sourceDir: tempDir });
    command.run!({ exclude: [] });

    const uninstallNames = mockedUninstallSkill.mock.calls.map((c) => c[0]);
    const installNames = mockedInstallSkill.mock.calls.map((c) => c[0].frontmatter.name);

    expect(uninstallNames.sort()).toEqual(["commit", "review"]);
    expect(installNames.sort()).toEqual(["commit", "review"]);
  });

  it("should exclude specified skills from sync", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillSyncCommand({ sourceDir: tempDir });
    command.run!({ exclude: ["commit"] });

    const uninstallNames = mockedUninstallSkill.mock.calls.map((c) => c[0]);
    const installNames = mockedInstallSkill.mock.calls.map((c) => c[0].frontmatter.name);

    expect(uninstallNames).toEqual(["review"]);
    expect(installNames).toEqual(["review"]);
  });

  it("should skip install when removal fails", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    mockedUninstallSkill.mockImplementation((name) => {
      if (name === "commit") throw new Error("removal failed");
    });

    const command = createSkillSyncCommand({ sourceDir: tempDir });
    command.run!({ exclude: [] });

    const installNames = mockedInstallSkill.mock.calls.map((c) => c[0].frontmatter.name);
    expect(installNames).toEqual(["review"]);
    expect(process.exitCode).toBe(1);
  });

  it("should do nothing when source directory is empty", () => {
    const command = createSkillSyncCommand({ sourceDir: tempDir });
    command.run!({ exclude: [] });

    expect(mockedInstallSkill).not.toHaveBeenCalled();
    expect(mockedUninstallSkill).not.toHaveBeenCalled();
  });
});

describe("createSkillAddCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mockedInstallSkill.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("should install all skills when no name is given", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillAddCommand({ sourceDir: tempDir });
    command.run!({ name: undefined });

    expect(mockedInstallSkill).toHaveBeenCalledTimes(2);
  });

  it("should install specific skill by name", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillAddCommand({ sourceDir: tempDir });
    command.run!({ name: "commit" });

    expect(mockedInstallSkill).toHaveBeenCalledTimes(1);
    expect(mockedInstallSkill.mock.calls[0]![0].frontmatter.name).toBe("commit");
  });

  it("should set exitCode when skill name not found", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillAddCommand({ sourceDir: tempDir });
    command.run!({ name: "nonexistent" });

    expect(process.exitCode).toBe(1);
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });
});

describe("createSkillRemoveCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mockedUninstallSkill.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("should remove all skills when no name is given", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillRemoveCommand({ sourceDir: tempDir });
    command.run!({ name: undefined });

    expect(mockedUninstallSkill).toHaveBeenCalledTimes(2);
  });

  it("should remove specific skill by name", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillRemoveCommand({ sourceDir: tempDir });
    command.run!({ name: "commit" });

    expect(mockedUninstallSkill).toHaveBeenCalledTimes(1);
    expect(mockedUninstallSkill.mock.calls[0]![0]).toBe("commit");
  });

  it("should set exitCode when skill name not found", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillRemoveCommand({ sourceDir: tempDir });
    command.run!({ name: "nonexistent" });

    expect(process.exitCode).toBe(1);
    expect(mockedUninstallSkill).not.toHaveBeenCalled();
  });
});
