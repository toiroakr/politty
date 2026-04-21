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
  readInstalledOwnership: vi.fn(),
  OWNERSHIP_METADATA_KEY: "politty-cli",
  AGENTS_SKILLS_DIR: ".agents/skills",
}));

const installer = await import("../installer.js");
const mockedInstallSkill = vi.mocked(installer.installSkill);
const mockedUninstallSkill = vi.mocked(installer.uninstallSkill);
const mockedReadOwnership = vi.mocked(installer.readInstalledOwnership);

const PACKAGE = "@my-agent/skills";
const CLI = "my-agent";
const OWNERSHIP = `${PACKAGE}:${CLI}`;

function opts(sourceDir: string) {
  return { sourceDir, package: PACKAGE };
}

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
    const command = createSkillListCommand(opts(tempDir), CLI);
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
    });

    const command = createSkillListCommand(opts(tempDir), CLI);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      command.run!({ json: true });
      expect(consoleSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output).toHaveLength(1);
      expect(output[0].name).toBe("commit");
      expect(output[0].description).toBe("Commit skill");
      expect(output[0].owner).toBe(OWNERSHIP);
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
    mockedReadOwnership.mockReset();
    mockedReadOwnership.mockReturnValue(OWNERSHIP);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should reinstall all skills without an explicit pre-remove pass", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillSyncCommand(opts(tempDir), CLI);
    command.run!({ exclude: [] });

    const uninstallNames = mockedUninstallSkill.mock.calls.map((c) => c[0]);
    const installNames = mockedInstallSkill.mock.calls.map((c) => c[0].frontmatter.name);

    // Skills still in source are replaced atomically via installSkill's
    // rename-over, so no explicit uninstall is emitted for them.
    expect(uninstallNames).toEqual([]);
    expect(installNames.sort()).toEqual(["commit", "review"]);
    for (const call of mockedInstallSkill.mock.calls) {
      expect(call[1]).toBe(OWNERSHIP);
    }
  });

  it("should exclude specified skills from sync", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillSyncCommand(opts(tempDir), CLI);
    command.run!({ exclude: ["commit"] });

    const uninstallNames = mockedUninstallSkill.mock.calls.map((c) => c[0]);
    const installNames = mockedInstallSkill.mock.calls.map((c) => c[0].frontmatter.name);

    expect(uninstallNames).toEqual([]);
    expect(installNames).toEqual(["review"]);
  });

  it("should refuse to overwrite a skill owned by someone else during sync", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue("other-pkg:other-cli");

    const command = createSkillSyncCommand(opts(tempDir), CLI);

    expect(() => command.run!({ exclude: [] })).toThrow(/Refusing to install/);
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should proceed when source directory has no skills (CLI dropped all)", () => {
    const command = createSkillSyncCommand(opts(tempDir), CLI);

    expect(() => command.run!({ exclude: [] })).not.toThrow();
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should skip orphan cleanup when source directory is missing", () => {
    // A typo'd sourceDir must not be treated as "CLI dropped every skill"
    // and silently wipe every install owned by this CLI.
    const command = createSkillSyncCommand(opts("/nonexistent/source"), CLI);

    expect(() => command.run!({ exclude: [] })).not.toThrow();
    expect(mockedUninstallSkill).not.toHaveBeenCalled();
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should remove owned orphans whose source was dropped by the CLI", async () => {
    // Orphan cleanup relies on findOwnedInstalledSkills reading .agents/skills.
    // Set up a fake install tree under cwd so the real readdirSync finds it.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    const projectDir = join(tempDir, ".project");
    const installedDir = join(projectDir, ".agents/skills");
    mkdirSync(join(installedDir, "orphan"), { recursive: true });
    writeFileSync(
      join(installedDir, "orphan", "SKILL.md"),
      `---\nname: orphan\ndescription: gone\nmetadata:\n  politty-cli: "${OWNERSHIP}"\n---\n`,
    );
    mkdirSync(join(installedDir, "other-cli-skill"), { recursive: true });
    writeFileSync(
      join(installedDir, "other-cli-skill", "SKILL.md"),
      `---\nname: other-cli-skill\ndescription: someone else\nmetadata:\n  politty-cli: "other:tool"\n---\n`,
    );

    // readInstalledOwnership mock needs to reflect the fake install tree.
    mockedReadOwnership.mockImplementation((n: string) => {
      if (n === "orphan") return OWNERSHIP;
      if (n === "other-cli-skill") return "other:tool";
      return OWNERSHIP;
    });

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir);

    try {
      const command = createSkillSyncCommand(opts(tempDir), CLI);
      command.run!({ exclude: [] });

      const uninstallNames = mockedUninstallSkill.mock.calls.map((c) => c[0]);
      expect(uninstallNames).toContain("orphan");
      expect(uninstallNames).not.toContain("other-cli-skill");
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("should skip owned orphan when it is in the exclude list", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    const projectDir = join(tempDir, ".project");
    const installedDir = join(projectDir, ".agents/skills");
    mkdirSync(join(installedDir, "orphan"), { recursive: true });
    writeFileSync(
      join(installedDir, "orphan", "SKILL.md"),
      `---\nname: orphan\ndescription: gone\nmetadata:\n  politty-cli: "${OWNERSHIP}"\n---\n`,
    );

    mockedReadOwnership.mockReturnValue(OWNERSHIP);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir);

    try {
      const command = createSkillSyncCommand(opts(tempDir), CLI);
      command.run!({ exclude: ["orphan"] });

      const uninstallNames = mockedUninstallSkill.mock.calls.map((c) => c[0]);
      expect(uninstallNames).not.toContain("orphan");
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("should still reinstall valid skills even when another skill has per-file errors", () => {
    // A parse-failed or name-mismatch on one skill must not block the rest
    // of the sync — the valid skills still represent what the CLI bundles.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    // Invalid SKILL.md (missing description) produces a per-file parse-failed error.
    const badDir = join(tempDir, "broken");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "SKILL.md"), "---\nname: broken\n---\n# missing description\n");

    const command = createSkillSyncCommand(opts(tempDir), CLI);
    command.run!({ exclude: [] });

    const installNames = mockedInstallSkill.mock.calls.map((c) => c[0].frontmatter.name);
    expect(installNames).toEqual(["commit"]);
  });
});

describe("createSkillAddCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mockedInstallSkill.mockReset();
    mockedReadOwnership.mockReset();
    // Default: nothing previously installed, so add is a fresh install.
    mockedReadOwnership.mockReturnValue(null);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should install all skills when no name is given", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillAddCommand(opts(tempDir), CLI);
    command.run!({ name: undefined });

    expect(mockedInstallSkill).toHaveBeenCalledTimes(2);
    for (const call of mockedInstallSkill.mock.calls) {
      expect(call[1]).toBe(OWNERSHIP);
    }
  });

  it("should install specific skill by name", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillAddCommand(opts(tempDir), CLI);
    command.run!({ name: "commit" });

    expect(mockedInstallSkill).toHaveBeenCalledTimes(1);
    expect(mockedInstallSkill.mock.calls[0]![0].frontmatter.name).toBe("commit");
  });

  it("should throw when requested skill name is not in source dir", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillAddCommand(opts(tempDir), CLI);

    expect(() => command.run!({ name: "nonexistent" })).toThrow(/not found/);
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should throw even when source dir is empty and a name was requested", () => {
    const command = createSkillAddCommand(opts(tempDir), CLI);

    expect(() => command.run!({ name: "commit" })).toThrow(/not found/);
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should refuse to overwrite a skill owned by another CLI", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue("other-pkg:other-cli");

    const command = createSkillAddCommand(opts(tempDir), CLI);

    expect(() => command.run!({ name: "commit" })).toThrow(/Refusing to install/);
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should allow reinstall when already owned by this CLI", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(OWNERSHIP);

    const command = createSkillAddCommand(opts(tempDir), CLI);
    command.run!({ name: "commit" });

    expect(mockedInstallSkill).toHaveBeenCalledTimes(1);
  });
});

describe("createSkillRemoveCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mockedUninstallSkill.mockReset();
    mockedReadOwnership.mockReset();
    mockedReadOwnership.mockReturnValue(OWNERSHIP);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should remove all skills when no name is given", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillRemoveCommand(opts(tempDir), CLI);
    command.run!({ name: undefined });

    expect(mockedUninstallSkill).toHaveBeenCalledTimes(2);
  });

  it("should remove specific skill by name", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillRemoveCommand(opts(tempDir), CLI);
    command.run!({ name: "commit" });

    expect(mockedUninstallSkill).toHaveBeenCalledTimes(1);
    expect(mockedUninstallSkill.mock.calls[0]![0]).toBe("commit");
  });

  it("should refuse to remove a skill owned by another CLI", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue("other-pkg:other-cli");

    const command = createSkillRemoveCommand(opts(tempDir), CLI);

    expect(() => command.run!({ name: "commit" })).toThrow(/Refusing to remove/);
    expect(mockedUninstallSkill).not.toHaveBeenCalled();
  });

  it("should allow direct-by-name removal when source dir has dropped the skill", () => {
    // Empty source dir, but the skill was previously installed by us.
    const command = createSkillRemoveCommand(opts(tempDir), CLI);
    command.run!({ name: "orphan" });

    expect(mockedUninstallSkill).toHaveBeenCalledWith("orphan");
  });

  it("should allow orphan removal even when source dir still bundles other skills", () => {
    // Source dir has other skills, but not "orphan" — should still remove it.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillRemoveCommand(opts(tempDir), CLI);
    command.run!({ name: "orphan" });

    expect(mockedUninstallSkill).toHaveBeenCalledWith("orphan");
  });

  it("should no-op when skill is not installed", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(null);

    const command = createSkillRemoveCommand(opts(tempDir), CLI);
    command.run!({ name: "commit" });

    expect(mockedUninstallSkill).not.toHaveBeenCalled();
  });
});
