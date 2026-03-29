import { execFileSync } from "node:child_process";
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

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

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
    mockedExecFileSync.mockReset();
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

    // Args: ["--yes", "skills", "remove"|"add", name|path]
    const calls = mockedExecFileSync.mock.calls;
    const removeNames = calls.filter((c) => c[1]![2] === "remove").map((c) => c[1]![3]);
    const addPaths = calls.filter((c) => c[1]![2] === "add").map((c) => c[1]![3]);

    expect(removeNames.sort()).toEqual(["commit", "review"]);
    expect(addPaths).toHaveLength(2);
  });

  it("should exclude specified skills from sync", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillSyncCommand({ sourceDir: tempDir });
    command.run!({ exclude: ["commit"] });

    const calls = mockedExecFileSync.mock.calls;
    const removeNames = calls.filter((c) => c[1]![2] === "remove").map((c) => c[1]![3]);
    const addPaths = calls.filter((c) => c[1]![2] === "add");

    expect(removeNames).toEqual(["review"]);
    expect(addPaths).toHaveLength(1);
  });

  it("should skip install when removal fails", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    // Make remove fail for "commit"
    // Args: ["--yes", "skills", "remove", name]
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      if (args![2] === "remove" && args![3] === "commit") {
        throw new Error("remove failed");
      }
      return Buffer.from("");
    });

    const command = createSkillSyncCommand({ sourceDir: tempDir });
    command.run!({ exclude: [] });

    // "commit" should not be re-added
    const addCalls = mockedExecFileSync.mock.calls.filter((c) => c[1]![2] === "add");
    const addedPaths = addCalls.map((c) => c[1]![3] as string);

    expect(addedPaths).toHaveLength(1);
    expect(addedPaths[0]).toContain("review");
    expect(process.exitCode).toBe(1);
  });

  it("should do nothing when source directory is empty", () => {
    const command = createSkillSyncCommand({ sourceDir: tempDir });
    command.run!({ exclude: [] });

    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });
});

describe("createSkillAddCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mockedExecFileSync.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("should set exitCode when no name provided and --all is false", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillAddCommand({ sourceDir: tempDir });
    command.run!({ name: undefined, all: false });

    expect(process.exitCode).toBe(1);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("should set exitCode when skill name not found", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillAddCommand({ sourceDir: tempDir });
    command.run!({ name: "nonexistent", all: false });

    expect(process.exitCode).toBe(1);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("should set exitCode when both --all and name are provided", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillAddCommand({ sourceDir: tempDir });
    command.run!({ name: "commit", all: true });

    expect(process.exitCode).toBe(1);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });
});

describe("createSkillRemoveCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mockedExecFileSync.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("should set exitCode when no name provided and --all is false", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillRemoveCommand({ sourceDir: tempDir });
    command.run!({ name: undefined, all: false });

    expect(process.exitCode).toBe(1);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("should set exitCode when skill name not found", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillRemoveCommand({ sourceDir: tempDir });
    command.run!({ name: "nonexistent", all: false });

    expect(process.exitCode).toBe(1);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("should set exitCode when both --all and name are provided", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillRemoveCommand({ sourceDir: tempDir });
    command.run!({ name: "commit", all: true });

    expect(process.exitCode).toBe(1);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });
});
