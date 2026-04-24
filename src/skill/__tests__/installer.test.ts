import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasInstalledSkill,
  installSkill,
  readInstalledOwnership,
  uninstallSkill,
} from "../installer.js";
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

function createSkillFixture(
  dir: string,
  name: string,
  ownership: string | null = OWNERSHIP,
): DiscoveredSkill {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const meta = ownership === null ? "" : `metadata:\n  politty-cli: ${JSON.stringify(ownership)}\n`;
  const raw = `---\nname: ${name}\ndescription: Test skill\n${meta}---\n# ${name}\n`;
  writeFileSync(join(skillDir, "SKILL.md"), raw);
  const frontmatter: DiscoveredSkill["frontmatter"] = {
    name,
    description: "Test skill",
    ...(ownership === null ? {} : { metadata: { "politty-cli": ownership } }),
  };
  return {
    frontmatter,
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

  it("should create .agents/skills/<name> as a symlink to the source", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, projectDir);

    const canonicalPath = join(projectDir, ".agents/skills/commit");
    expect(lstatSync(canonicalPath).isSymbolicLink()).toBe(true);
    // Reading through the symlink yields the source SKILL.md verbatim.
    expect(readFileSync(join(canonicalPath, "SKILL.md"), "utf-8")).toContain("name: commit");
  });

  it("should not write back to the source SKILL.md", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    const before = readFileSync(join(skill.sourcePath, "SKILL.md"), "utf-8");

    installSkill(skill, projectDir);

    // The installer is a pure symlink operation; source content must be byte-identical.
    expect(readFileSync(join(skill.sourcePath, "SKILL.md"), "utf-8")).toBe(before);
  });

  it("should expose the source's authored ownership stamp via readInstalledOwnership", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, projectDir);

    expect(readInstalledOwnership("commit", projectDir)).toBe(OWNERSHIP);
  });

  it("should populate .claude/skills/<name>/ as a symlink to the canonical path", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, projectDir);

    const claudePath = join(projectDir, ".claude/skills/commit");
    const stat = lstatSync(claudePath);
    expect(stat.isSymbolicLink()).toBe(true);
    // The relative link should point at the canonical directory, not the source.
    const linkTarget = readlinkSync(claudePath);
    expect(linkTarget).toBe(join("..", "..", ".agents/skills/commit"));
    expect(readFileSync(join(claudePath, "SKILL.md"), "utf-8")).toContain("name: commit");
  });

  it("should reflect source updates live via the symlink", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    installSkill(skill, projectDir);

    // Updating the source after install must be observable through the
    // installed path without a re-run, since the install is a symlink.
    writeFileSync(
      join(skill.sourcePath, "SKILL.md"),
      `---\nname: commit\ndescription: Updated\nmetadata:\n  politty-cli: "${OWNERSHIP}"\n---\nupdated body\n`,
    );

    const content = readFileSync(join(projectDir, ".agents/skills/commit/SKILL.md"), "utf-8");
    expect(content).toContain("Updated");
    expect(content).toContain("updated body");
  });

  it("should overwrite an existing installation", () => {
    const firstSource = createTempDir();
    const secondSource = createTempDir();
    try {
      const first = createSkillFixture(firstSource, "commit");
      installSkill(first, projectDir);

      const second = createSkillFixture(secondSource, "commit");
      writeFileSync(
        join(second.sourcePath, "SKILL.md"),
        `---\nname: commit\ndescription: Updated\nmetadata:\n  politty-cli: "${OWNERSHIP}"\n---\nv2\n`,
      );
      installSkill(second, projectDir);

      const content = readFileSync(join(projectDir, ".agents/skills/commit/SKILL.md"), "utf-8");
      expect(content).toContain("Updated");
    } finally {
      rmSync(firstSource, { recursive: true, force: true });
      rmSync(secondSource, { recursive: true, force: true });
    }
  });

  it("should reject unsafe skill names", () => {
    const skill: DiscoveredSkill = {
      frontmatter: { name: "../escape", description: "bad" },
      sourcePath: sourceDir,
      rawContent: "",
    };

    expect(() => installSkill(skill, projectDir)).toThrow(/Invalid skill name/);
  });

  it("should refuse to replace a real canonical directory (legacy install)", () => {
    // A real directory at .agents/skills/<name> means a prior legacy or
    // manual install. The previous `rmSync(recursive)` would have blown
    // it away; the install primitive must now throw instead so data
    // isn't silently lost when a programmatic caller skips the
    // addSkill wrapper's hasInstalledSkill guard.
    const legacyDir = join(projectDir, ".agents/skills/commit");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "SKILL.md"), "---\nname: commit\ndescription: legacy\n---\n");

    const skill = createSkillFixture(sourceDir, "commit");

    expect(() => installSkill(skill, projectDir)).toThrow(/Refusing to replace non-symlink/);
    // Legacy content must remain intact.
    expect(readFileSync(join(legacyDir, "SKILL.md"), "utf-8")).toContain("legacy");
  });

  it("should refuse to replace a real .claude/skills/<name> directory", () => {
    // populateAgentDirs also needs to refuse, not recursively delete, a
    // real directory at .claude/skills/<name> that some other tool or
    // the user created.
    const legacyClaudeDir = join(projectDir, ".claude/skills/commit");
    mkdirSync(legacyClaudeDir, { recursive: true });
    writeFileSync(
      join(legacyClaudeDir, "SKILL.md"),
      "---\nname: commit\ndescription: legacy-claude\n---\n",
    );

    const skill = createSkillFixture(sourceDir, "commit");

    expect(() => installSkill(skill, projectDir)).toThrow(/Refusing to replace non-symlink/);
    expect(readFileSync(join(legacyClaudeDir, "SKILL.md"), "utf-8")).toContain("legacy-claude");
  });

  it("should throw if realpathSync fails (missing source)", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    // Point sourcePath at a non-existent location so realpathSync throws.
    const broken: DiscoveredSkill = {
      ...skill,
      sourcePath: resolve(sourceDir, "does-not-exist"),
    };

    expect(() => installSkill(broken, projectDir)).toThrow();
  });

  it("should copy the source when mode is 'copy'", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, projectDir, { mode: "copy" });

    const canonicalPath = join(projectDir, ".agents/skills/commit");
    // In copy mode the slot is a real directory, not a symlink.
    expect(lstatSync(canonicalPath).isDirectory()).toBe(true);
    expect(lstatSync(canonicalPath).isSymbolicLink()).toBe(false);
    // Content comes from the copied source.
    expect(readFileSync(join(canonicalPath, "SKILL.md"), "utf-8")).toContain("name: commit");
  });

  it("should not reflect source updates when mode is 'copy'", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    installSkill(skill, projectDir, { mode: "copy" });

    // Copy-mode installs are snapshots — editing the source after install
    // should NOT leak into the installed location.
    writeFileSync(
      join(skill.sourcePath, "SKILL.md"),
      `---\nname: commit\ndescription: Updated\nmetadata:\n  politty-cli: "${OWNERSHIP}"\n---\nupdated body\n`,
    );

    const content = readFileSync(join(projectDir, ".agents/skills/commit/SKILL.md"), "utf-8");
    expect(content).not.toContain("Updated");
    expect(content).not.toContain("updated body");
  });

  it("should populate .claude/skills/<name>/ via copy when mode is 'copy'", () => {
    const skill = createSkillFixture(sourceDir, "commit");

    installSkill(skill, projectDir, { mode: "copy" });

    const claudePath = join(projectDir, ".claude/skills/commit");
    const stat = lstatSync(claudePath);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(readFileSync(join(claudePath, "SKILL.md"), "utf-8")).toContain("name: commit");
  });

  it("should replace a previous copy-mode install in place", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    installSkill(skill, projectDir, { mode: "copy" });

    writeFileSync(
      join(skill.sourcePath, "SKILL.md"),
      `---\nname: commit\ndescription: V2\nmetadata:\n  politty-cli: "${OWNERSHIP}"\n---\nv2 body\n`,
    );
    installSkill(skill, projectDir, { mode: "copy" });

    const content = readFileSync(join(projectDir, ".agents/skills/commit/SKILL.md"), "utf-8");
    expect(content).toContain("V2");
    expect(content).toContain("v2 body");
  });

  it("should switch a copy-mode install to a symlink when re-installed with mode 'symlink'", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    installSkill(skill, projectDir, { mode: "copy" });
    expect(lstatSync(join(projectDir, ".agents/skills/commit")).isDirectory()).toBe(true);

    // A subsequent install with a different mode must clear the copy-mode
    // real directory (our own prior install, same ownership stamp) and
    // replace it with a symlink.
    installSkill(skill, projectDir, { mode: "symlink" });
    expect(lstatSync(join(projectDir, ".agents/skills/commit")).isSymbolicLink()).toBe(true);
  });

  it("should throw in 'symlink' mode when symlinkSync fails", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    // Monkey-patch realpathSync via a non-writable target name? Easiest is
    // to pre-populate the slot with a foreign real dir so clearInstallSlot
    // throws — exercises the "throws rather than copies" contract.
    const legacyDir = join(projectDir, ".agents/skills/commit");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "SKILL.md"),
      "---\nname: commit\ndescription: legacy\n---\n# legacy\n",
    );

    expect(() => installSkill(skill, projectDir, { mode: "symlink" })).toThrow();
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

  it("should not touch the source directory", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    installSkill(skill, projectDir);

    uninstallSkill("commit", projectDir);

    // Symlink-based uninstall must not reach through to delete the source.
    expect(existsSync(join(skill.sourcePath, "SKILL.md"))).toBe(true);
  });

  it("should not throw when skill is not installed", () => {
    expect(() => uninstallSkill("nonexistent", projectDir)).not.toThrow();
  });

  it("should leave a real directory at the install path untouched without expectedOwnership", () => {
    // A legacy/manual install is a real directory (not a symlink) at
    // .agents/skills/<name>. Without expectedOwnership, uninstallSkill is
    // conservative and only unlinks symlinks — real data is never rm -rf'd.
    const canonicalDir = join(projectDir, ".agents/skills/legacy");
    mkdirSync(canonicalDir, { recursive: true });
    const skillMd = join(canonicalDir, "SKILL.md");
    writeFileSync(skillMd, "---\nname: legacy\ndescription: manual\n---\n# Legacy\n");

    uninstallSkill("legacy", projectDir);

    expect(existsSync(canonicalDir)).toBe(true);
    expect(readFileSync(skillMd, "utf-8")).toContain("name: legacy");
  });

  it("should remove a copy-mode install when expectedOwnership matches", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    installSkill(skill, projectDir, { mode: "copy" });
    expect(lstatSync(join(projectDir, ".agents/skills/commit")).isDirectory()).toBe(true);

    uninstallSkill("commit", projectDir, { expectedOwnership: OWNERSHIP });

    expect(existsSync(join(projectDir, ".agents/skills/commit"))).toBe(false);
    expect(existsSync(join(projectDir, ".claude/skills/commit"))).toBe(false);
  });

  it("should refuse to remove a real directory whose stamp does not match", () => {
    // A real directory carrying some other tool's ownership stamp must not
    // be rm -rf'd just because uninstallSkill was called with our own stamp.
    const canonicalDir = join(projectDir, ".agents/skills/foreign");
    mkdirSync(canonicalDir, { recursive: true });
    const skillMd = join(canonicalDir, "SKILL.md");
    writeFileSync(
      skillMd,
      '---\nname: foreign\ndescription: other\nmetadata:\n  politty-cli: "other:tool"\n---\n',
    );

    uninstallSkill("foreign", projectDir, { expectedOwnership: OWNERSHIP });

    expect(existsSync(canonicalDir)).toBe(true);
    expect(readFileSync(skillMd, "utf-8")).toContain("other:tool");
  });

  it("should remove symlinks regardless of expectedOwnership", () => {
    // Symlinks were created by some install flow; uninstall should always
    // unlink them so a plain `uninstallSkill(name, cwd)` call still cleans
    // up symlink-mode installs.
    const skill = createSkillFixture(sourceDir, "commit");
    installSkill(skill, projectDir, { mode: "symlink" });

    uninstallSkill("commit", projectDir);

    expect(existsSync(join(projectDir, ".agents/skills/commit"))).toBe(false);
    expect(existsSync(join(projectDir, ".claude/skills/commit"))).toBe(false);
  });
});

describe("readInstalledOwnership", () => {
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

  it("should return null when the skill is not installed", () => {
    expect(readInstalledOwnership("nobody", projectDir)).toBeNull();
  });

  it("should return null when metadata.politty-cli is absent", () => {
    const skill = createSkillFixture(sourceDir, "noowner", null);
    installSkill(skill, projectDir);

    expect(readInstalledOwnership("noowner", projectDir)).toBeNull();
  });

  it("should return the stamp authored in the source SKILL.md", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    installSkill(skill, projectDir);

    expect(readInstalledOwnership("commit", projectDir)).toBe(OWNERSHIP);
  });

  it("should return null when the canonical symlink is broken", () => {
    // Simulate the source directory being removed after install (e.g. an
    // npm package was uninstalled but sync was not re-run). The broken
    // link should read as "not installed", not as a hard failure.
    const skill = createSkillFixture(sourceDir, "commit");
    installSkill(skill, projectDir);
    rmSync(skill.sourcePath, { recursive: true, force: true });

    expect(readInstalledOwnership("commit", projectDir)).toBeNull();
  });

  it("should accept a symlinked source SKILL.md", () => {
    // Previously the scanner refused source SKILL.md symlinks as an
    // attack; the new model allows them because npm packages already
    // execute arbitrary JS. Make sure the install + ownership read path
    // does not regress into refusing them.
    const skillDir = join(sourceDir, "linked");
    mkdirSync(skillDir, { recursive: true });
    const realTarget = join(sourceDir, "linked.md");
    writeFileSync(
      realTarget,
      `---\nname: linked\ndescription: linked\nmetadata:\n  politty-cli: "${OWNERSHIP}"\n---\n`,
    );
    symlinkSync(realTarget, join(skillDir, "SKILL.md"), "file");

    const skill: DiscoveredSkill = {
      frontmatter: {
        name: "linked",
        description: "linked",
        metadata: { "politty-cli": OWNERSHIP },
      },
      sourcePath: skillDir,
      rawContent: "",
    };

    installSkill(skill, projectDir);

    expect(readInstalledOwnership("linked", projectDir)).toBe(OWNERSHIP);
  });
});

describe("hasInstalledSkill", () => {
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

  it("should return false when nothing is installed", () => {
    expect(hasInstalledSkill("nobody", projectDir)).toBe(false);
  });

  it("should return true for an installed skill (even without a stamp)", () => {
    const skill = createSkillFixture(sourceDir, "unstamped", null);
    installSkill(skill, projectDir);

    // hasInstalledSkill is ownership-blind by design: it exists specifically
    // to let callers distinguish "not installed" from "installed but
    // unstamped" (readInstalledOwnership returns null for both).
    expect(hasInstalledSkill("unstamped", projectDir)).toBe(true);
  });

  it("should return true for an installed skill with a valid stamp", () => {
    const skill = createSkillFixture(sourceDir, "stamped");
    installSkill(skill, projectDir);

    expect(hasInstalledSkill("stamped", projectDir)).toBe(true);
  });

  it("should return false when the canonical symlink is broken", () => {
    // A broken canonical (source package removed after install) is treated
    // as "not installed" so `skills add` can fresh-install without hitting
    // the legacy-install refusal.
    const skill = createSkillFixture(sourceDir, "commit");
    installSkill(skill, projectDir);
    rmSync(skill.sourcePath, { recursive: true, force: true });

    expect(hasInstalledSkill("commit", projectDir)).toBe(false);
  });

  it("should return true for a manually-created unstamped SKILL.md", () => {
    // Simulates a legacy or manual install: a real directory with a real
    // SKILL.md, not managed by this CLI. `skills add` must refuse to
    // clobber it, so hasInstalledSkill must report its presence.
    const manualDir = resolve(projectDir, ".agents/skills/legacy");
    mkdirSync(manualDir, { recursive: true });
    writeFileSync(
      join(manualDir, "SKILL.md"),
      "---\nname: legacy\ndescription: manual\n---\n# Legacy\n",
    );

    expect(hasInstalledSkill("legacy", projectDir)).toBe(true);
  });

  it("should reject unsafe skill names", () => {
    expect(() => hasInstalledSkill("../escape", projectDir)).toThrow(/Invalid skill name/);
  });
});
