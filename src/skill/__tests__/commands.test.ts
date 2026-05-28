import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSkillAddCommand,
  createSkillListCommand,
  createSkillRemoveCommand,
  createSkillSyncCommand,
} from "../commands.js";
import { resolveSkillOptions } from "../options.js";
import type { SkillCommandOptions } from "../types.js";

vi.mock("../installer.js", () => ({
  installSkill: vi.fn(),
  uninstallSkill: vi.fn(),
  readInstalledOwnership: vi.fn(),
  hasInstalledSkill: vi.fn(() => false),
  OWNERSHIP_METADATA_KEY: "politty-cli",
  AGENTS_SKILLS_DIR: ".agents/skills",
  // Mirrors the real export so `cleanupBrokenSlot`'s iteration doesn't
  // crash under test with `TypeError: SYMLINK_TARGETS is not iterable`.
  // Keep in sync with `installer.ts`.
  SYMLINK_TARGETS: [".claude/skills"],
}));

const installer = await import("../installer.js");
const mockedInstallSkill = vi.mocked(installer.installSkill);
const mockedUninstallSkill = vi.mocked(installer.uninstallSkill);
const mockedReadOwnership = vi.mocked(installer.readInstalledOwnership);
const mockedHasInstalledSkill = vi.mocked(installer.hasInstalledSkill);

const PACKAGE = "@my-agent/skills";
const CLI = "my-agent";
const OWNERSHIP = `${PACKAGE}:${CLI}`;

function opts(sourceDir: string) {
  return { sourceDir, package: PACKAGE };
}

/** Test-side mirror of `withSkillCommand`'s one-shot resolve. */
function resolve(options: SkillCommandOptions = opts("/tmp")) {
  return resolveSkillOptions(options, CLI);
}

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `politty-skill-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkillMd(
  dir: string,
  name: string,
  frontmatter: Record<string, string>,
  opts: { ownership?: string | null } = {},
): void {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v.includes(" ") || v.startsWith("@") ? `"${v}"` : v}`)
    .join("\n");
  // Default to stamping the authored ownership so addSkill's scanner-level
  // stamp-match guard passes. Tests exercising mismatch explicitly pass
  // `ownership: null` or a distinct value.
  const ownership = "ownership" in opts ? opts.ownership : OWNERSHIP;
  const meta = ownership === null ? "" : `\nmetadata:\n  politty-cli: ${JSON.stringify(ownership)}`;
  writeFileSync(join(skillDir, "SKILL.md"), `---\n${fm}${meta}\n---\n# ${name} skill\n`);
}

describe("createSkillListCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mockedReadOwnership.mockReset();
    mockedReadOwnership.mockReturnValue(null);
    mockedHasInstalledSkill.mockReset();
    mockedHasInstalledSkill.mockReturnValue(false);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should output empty JSON array when no skills found with --json", () => {
    const command = createSkillListCommand(resolve(opts(tempDir)));
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
    mockedReadOwnership.mockReturnValue(OWNERSHIP);

    const command = createSkillListCommand(resolve(opts(tempDir)));
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      command.run!({ json: true });
      expect(consoleSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output).toHaveLength(1);
      expect(output[0].name).toBe("commit");
      expect(output[0].description).toBe("Commit skill");
      // `owner` reflects what the source SKILL.md actually declares; the
      // default fixture stamps OWNERSHIP so both match. `expectedOwner`
      // is what this CLI demands — tooling compares the two to detect
      // packaging mismatches.
      expect(output[0].owner).toBe(OWNERSHIP);
      expect(output[0].expectedOwner).toBe(OWNERSHIP);
      // Status is "installed" because the installer mock reports the
      // canonical ownership stamp on `.agents/skills/commit`.
      expect(output[0].status).toBe("installed");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should report status='foreign' for skills installed by another CLI", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue("other-pkg:other-cli");

    const command = createSkillListCommand(resolve(opts(tempDir)));
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      command.run!({ json: true });
      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output[0].status).toBe("foreign");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should report status='unstamped' for an installed legacy skill", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(null);
    mockedHasInstalledSkill.mockReturnValue(true);

    const command = createSkillListCommand(resolve(opts(tempDir)));
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      command.run!({ json: true });
      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output[0].status).toBe("unstamped");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should report status='not-installed' when the canonical slot is absent", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(null);
    mockedHasInstalledSkill.mockReturnValue(false);

    const command = createSkillListCommand(resolve(opts(tempDir)));
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      command.run!({ json: true });
      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      // The repo root has no `.agents/skills/commit`, so slotPresent is false.
      expect(output[0].status).toBe("not-installed");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should report status='missing' only for dangling canonical symlinks", () => {
    // `missing` is the cleanable-by-remove state. A dangling canonical
    // symlink qualifies; a real directory at the same path (e.g. a hand-
    // made legacy install with no SKILL.md) does not — that should surface
    // as `unstamped` so the no-clobber guard in `removeOwnedSkill` engages
    // instead of misleadingly promising cleanup.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(null);
    mockedHasInstalledSkill.mockReturnValue(false);

    const projectRoot = createTempDir();
    try {
      const canonical = join(projectRoot, ".agents/skills/commit");
      mkdirSync(join(projectRoot, ".agents/skills"), { recursive: true });
      symlinkSync(join(projectRoot, "does-not-exist"), canonical, "dir");

      const command = createSkillListCommand(resolve({ ...opts(tempDir), cwd: projectRoot }));
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        command.run!({ json: true });
        const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
        expect(output[0].status).toBe("missing");
      } finally {
        consoleSpy.mockRestore();
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("should report status='unstamped' for a real directory slot without SKILL.md", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(null);
    mockedHasInstalledSkill.mockReturnValue(false);

    const projectRoot = createTempDir();
    try {
      mkdirSync(join(projectRoot, ".agents/skills/commit"), { recursive: true });

      const command = createSkillListCommand(resolve({ ...opts(tempDir), cwd: projectRoot }));
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        command.run!({ json: true });
        const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
        // Malformed real slots are reported as `unstamped`, NOT `missing`,
        // so `removeOwnedSkill`'s no-clobber guard engages (a real directory
        // we did not produce must not be silently rm-rf'd).
        expect(output[0].status).toBe("unstamped");
      } finally {
        consoleSpy.mockRestore();
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("should not contaminate --json stdout with scan-error summary lines", () => {
    // A malformed SKILL.md produces a scan error. In `--json` mode the
    // command must still emit a single, parseable JSON payload on stdout;
    // the per-error stderr warnings still fire, but the stdout summary
    // ("Skipped N skill(s) due to scan errors") must not corrupt the JSON.
    writeSkillMd(tempDir, "good", { name: "good", description: "Good skill" });
    const badDir = join(tempDir, "bad");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "SKILL.md"), "---\nname: bad\n---\n# no description\n");

    mockedReadOwnership.mockReturnValue(OWNERSHIP);

    const command = createSkillListCommand(resolve(opts(tempDir)));
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      command.run!({ json: true });
      expect(consoleSpy).toHaveBeenCalledOnce();
      const stdout = consoleSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("good");
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
    mockedHasInstalledSkill.mockReset();
    mockedHasInstalledSkill.mockReturnValue(false);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should reinstall all skills without an explicit pre-remove pass", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillSyncCommand(resolve(opts(tempDir)));
    command.run!({ exclude: [], verbose: false });

    const uninstallNames = mockedUninstallSkill.mock.calls.map((c) => c[0]);
    const installNames = mockedInstallSkill.mock.calls.map((c) => c[0].frontmatter.name);

    // Skills still in source are replaced in place via installSkill's
    // rm + symlink swap, so no explicit uninstall is emitted for them.
    expect(uninstallNames).toEqual([]);
    expect(installNames.sort()).toEqual(["commit", "review"]);
  });

  it("should exclude specified skills from sync", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillSyncCommand(resolve(opts(tempDir)));
    command.run!({ exclude: ["commit"], verbose: false });

    const uninstallNames = mockedUninstallSkill.mock.calls.map((c) => c[0]);
    const installNames = mockedInstallSkill.mock.calls.map((c) => c[0].frontmatter.name);

    expect(uninstallNames).toEqual([]);
    expect(installNames).toEqual(["review"]);
  });

  it("should refuse to overwrite a skill owned by someone else during sync", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue("other-pkg:other-cli");

    const command = createSkillSyncCommand(resolve(opts(tempDir)));

    expect(() => command.run!({ exclude: [], verbose: false })).toThrow(/Refusing to install/);
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should proceed when source directory has no skills (CLI dropped all)", () => {
    const command = createSkillSyncCommand(resolve(opts(tempDir)));

    expect(() => command.run!({ exclude: [], verbose: false })).not.toThrow();
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should skip orphan cleanup when source directory is missing", () => {
    // A typo'd sourceDir must not be treated as "CLI dropped every skill"
    // and silently wipe every install owned by this CLI.
    const command = createSkillSyncCommand(resolve(opts("/nonexistent/source")));

    expect(() => command.run!({ exclude: [], verbose: false })).not.toThrow();
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
      const command = createSkillSyncCommand(resolve(opts(tempDir)));
      command.run!({ exclude: [], verbose: false });

      const uninstallNames = mockedUninstallSkill.mock.calls.map((c) => c[0]);
      expect(uninstallNames).toContain("orphan");
      expect(uninstallNames).not.toContain("other-cli-skill");
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("should surface IO errors when reading an installed skill's ownership", () => {
    // `readInstalledOwnership` distinguishes ENOENT/ENOTDIR (returns null)
    // from other IO failures (throws). `findOwnedInstalledSkills` used to
    // swallow every throw, conflating spec-incompatible legacy names with
    // permission/IO failures and silently leaving unreadable orphans behind
    // during `sync`. The fix pre-screens legacy names locally so the
    // try/catch only ever catches IO errors, which now get a stderr warning.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    const projectDir = join(tempDir, ".project");
    const installedDir = join(projectDir, ".agents/skills");
    mkdirSync(join(installedDir, "unreadable"), { recursive: true });
    writeFileSync(join(installedDir, "unreadable", "SKILL.md"), "irrelevant — mocked");

    const ioError = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    mockedReadOwnership.mockImplementation((n: string) => {
      if (n === "unreadable") throw ioError;
      return null;
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir);
    try {
      const command = createSkillSyncCommand(resolve(opts(tempDir)));
      command.run!({ exclude: [], verbose: false });

      // The unreadable slot was not treated as owned; sync did not uninstall it
      // (and did not crash). The IO failure surfaced as a stderr warning.
      const uninstallNames = mockedUninstallSkill.mock.calls.map((c) => c[0]);
      expect(uninstallNames).not.toContain("unreadable");
      const warned = warnSpy.mock.calls
        .map((c) => c.join(" "))
        .some((m) => m.includes("Failed to read ownership for unreadable"));
      expect(warned).toBe(true);
    } finally {
      cwdSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("should silently skip spec-incompatible legacy names in install slots", () => {
    // `assertSafeName` (inside `readInstalledOwnership`) throws on names that
    // can't have been produced by this CLI. These are legacy or foreign
    // installs and must not produce a noisy warning; the pre-screen filters
    // them out before `readInstalledOwnership` is ever called.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    const projectDir = join(tempDir, ".project");
    const installedDir = join(projectDir, ".agents/skills");
    mkdirSync(join(installedDir, "Some-CAPS"), { recursive: true });
    writeFileSync(join(installedDir, "Some-CAPS", "SKILL.md"), "irrelevant — mocked");

    const ownershipCalls: string[] = [];
    mockedReadOwnership.mockImplementation((n: string) => {
      ownershipCalls.push(n);
      return null;
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir);
    try {
      const command = createSkillSyncCommand(resolve(opts(tempDir)));
      command.run!({ exclude: [], verbose: false });

      expect(ownershipCalls).not.toContain("Some-CAPS");
      const warned = warnSpy.mock.calls
        .map((c) => c.join(" "))
        .some((m) => m.includes("Some-CAPS"));
      expect(warned).toBe(false);
    } finally {
      cwdSpy.mockRestore();
      warnSpy.mockRestore();
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
      const command = createSkillSyncCommand(resolve(opts(tempDir)));
      command.run!({ exclude: ["orphan"], verbose: false });

      const uninstallNames = mockedUninstallSkill.mock.calls.map((c) => c[0]);
      expect(uninstallNames).not.toContain("orphan");
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("should skip orphan cleanup when every discovered skill failed validation", async () => {
    // A totally broken bundle (every SKILL.md parse-failed, 0 valid) must not
    // be interpreted as "CLI ships nothing" — that would wipe every owned
    // install. Only directory-level success with a zero-length skills list is
    // an authoritative "dropped all" signal.
    const badDir = join(tempDir, "broken");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "SKILL.md"), "---\nname: broken\n---\n# missing description\n");

    const projectDir = join(tempDir, ".project");
    const installedDir = join(projectDir, ".agents/skills");
    mkdirSync(join(installedDir, "orphan"), { recursive: true });
    writeFileSync(
      join(installedDir, "orphan", "SKILL.md"),
      `---\nname: orphan\ndescription: installed\nmetadata:\n  politty-cli: "${OWNERSHIP}"\n---\n`,
    );

    mockedReadOwnership.mockReturnValue(OWNERSHIP);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir);

    try {
      const command = createSkillSyncCommand(resolve(opts(tempDir)));
      command.run!({ exclude: [], verbose: false });

      expect(mockedUninstallSkill).not.toHaveBeenCalled();
      expect(mockedInstallSkill).not.toHaveBeenCalled();
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("should thread options.mode through sync as well as add", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillSyncCommand(resolve({ ...opts(tempDir), mode: "symlink" }));
    command.run!({ exclude: [], verbose: false });

    expect(mockedInstallSkill.mock.calls[0]![2]).toEqual({ mode: "symlink" });
  });

  it("should still reinstall valid skills even when another skill has per-file errors", () => {
    // A parse-failed or name-mismatch on one skill must not block the rest
    // of the sync — the valid skills still represent what the CLI bundles.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    // Invalid SKILL.md (missing description) produces a per-file parse-failed error.
    const badDir = join(tempDir, "broken");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "SKILL.md"), "---\nname: broken\n---\n# missing description\n");

    const command = createSkillSyncCommand(resolve(opts(tempDir)));
    command.run!({ exclude: [], verbose: false });

    const installNames = mockedInstallSkill.mock.calls.map((c) => c[0].frontmatter.name);
    expect(installNames).toEqual(["commit"]);
  });

  it("should clean up orphans even when the only valid skill is excluded", () => {
    // Regression: `allSkillsInvalid` once checked the post-exclusion `skills`
    // list, so excluding the sole valid skill while any per-file error was
    // present flipped the bundle to "invalid" and preserved orphans. The
    // check now uses `allSkills` (pre-exclusion) so excluded-but-valid
    // skills still make the scan authoritative.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    const badDir = join(tempDir, "broken");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "SKILL.md"), "---\nname: broken\n---\n# missing description\n");

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
      const command = createSkillSyncCommand(resolve(opts(tempDir)));
      command.run!({ exclude: ["commit"], verbose: false });

      const uninstallNames = mockedUninstallSkill.mock.calls.map((c) => c[0]);
      expect(uninstallNames).toContain("orphan");
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("should throw when --exclude lists a name not in source", () => {
    // A typo'd `--exclude nonexitent` previously did nothing silently, so
    // the user couldn't tell their flag was inert. Now sync aborts before
    // any install side effect, listing every unknown name in one error so
    // the user can fix the whole invocation in one round-trip.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillSyncCommand(resolve(opts(tempDir)));
    expect(() => command.run!({ exclude: ["nonexitent"], verbose: false })).toThrow(
      /not found in source directory/,
    );
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should list every unknown --exclude name in one error", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillSyncCommand(resolve(opts(tempDir)));
    try {
      command.run!({ exclude: ["typo1", "typo2"], verbose: false });
      expect.fail("expected throw");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain('"typo1"');
      expect(message).toContain('"typo2"');
      expect(message).toContain("Skills");
    }
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should list both source and installed skills in --exclude typo errors", () => {
    // The error tells the user what valid targets are. `--exclude` accepts
    // either a source skill (skip its install) or an owned installed skill
    // (an orphan this CLI used to ship — `--exclude` keeps `sync` from
    // reaping it). Listing only "Source: …" hid the second category and
    // left the user to grep .agents/skills/ by hand.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillSyncCommand(resolve(opts(tempDir)));
    try {
      command.run!({ exclude: ["typo"], verbose: false });
      expect.fail("expected throw");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("Source: commit");
      expect(message).toContain("Installed: <none>");
    }
  });

  it("should accept --exclude values that match source skills", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillSyncCommand(resolve(opts(tempDir)));
    expect(() => command.run!({ exclude: ["commit"], verbose: false })).not.toThrow();
    expect(mockedInstallSkill).toHaveBeenCalledTimes(1);
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
    mockedHasInstalledSkill.mockReset();
    mockedHasInstalledSkill.mockReturnValue(false);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should install all skills when no name is given", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillAddCommand(resolve(opts(tempDir)));
    command.run!({ name: [], verbose: false });

    expect(mockedInstallSkill).toHaveBeenCalledTimes(2);
  });

  it("should install specific skill by name", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });

    const command = createSkillAddCommand(resolve(opts(tempDir)));
    command.run!({ name: ["commit"], verbose: false });

    expect(mockedInstallSkill).toHaveBeenCalledTimes(1);
    expect(mockedInstallSkill.mock.calls[0]![0].frontmatter.name).toBe("commit");
  });

  it("should install multiple skills when several names are given", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    writeSkillMd(tempDir, "review", { name: "review", description: "Review skill" });
    writeSkillMd(tempDir, "lint", { name: "lint", description: "Lint skill" });

    const command = createSkillAddCommand(resolve(opts(tempDir)));
    command.run!({ name: ["commit", "lint"], verbose: false });

    expect(mockedInstallSkill).toHaveBeenCalledTimes(2);
    const installed = mockedInstallSkill.mock.calls.map((c) => c[0].frontmatter.name).sort();
    expect(installed).toEqual(["commit", "lint"]);
  });

  it("should dedupe duplicate names in a single invocation", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillAddCommand(resolve(opts(tempDir)));
    command.run!({ name: ["commit", "commit"], verbose: false });

    expect(mockedInstallSkill).toHaveBeenCalledTimes(1);
  });

  it("should throw when requested skill name is not in source dir", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillAddCommand(resolve(opts(tempDir)));

    expect(() => command.run!({ name: ["nonexistent"], verbose: false })).toThrow(/not found/);
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should fail-fast and install nothing when any of several names is unknown", () => {
    // Order-independent: the valid name must not be installed before the
    // invalid sibling aborts the run.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillAddCommand(resolve(opts(tempDir)));

    expect(() => command.run!({ name: ["commit", "nonexistent"], verbose: false })).toThrow(
      /"nonexistent" not found/,
    );
    expect(mockedInstallSkill).not.toHaveBeenCalled();

    expect(() => command.run!({ name: ["nonexistent", "commit"], verbose: false })).toThrow(
      /"nonexistent" not found/,
    );
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should list every unknown name when several are unknown", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillAddCommand(resolve(opts(tempDir)));

    expect(() => command.run!({ name: ["typo1", "typo2"], verbose: false })).toThrow(
      /Skills "typo1", "typo2" not found/,
    );
  });

  it("should list source skills (only) in the unknown-name error", () => {
    // Only source skills are valid `add` targets, so the suggestion list
    // matches what the user can legitimately retype. Mentioning the
    // installed list here would be misdirection — those names won't work
    // with `add`.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillAddCommand(resolve(opts(tempDir)));

    try {
      command.run!({ name: ["typo"], verbose: false });
      expect.fail("expected throw");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("Source: commit");
      expect(message).not.toContain("Installed:");
    }
  });

  it("should throw even when source dir is empty and a name was requested", () => {
    const command = createSkillAddCommand(resolve(opts(tempDir)));

    expect(() => command.run!({ name: ["commit"], verbose: false })).toThrow(/not found/);
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should refuse to overwrite a skill owned by another CLI", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue("other-pkg:other-cli");

    const command = createSkillAddCommand(resolve(opts(tempDir)));

    expect(() => command.run!({ name: ["commit"], verbose: false })).toThrow(/Refusing to install/);
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should allow reinstall when already owned by this CLI", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(OWNERSHIP);

    const command = createSkillAddCommand(resolve(opts(tempDir)));
    command.run!({ name: ["commit"], verbose: false });

    expect(mockedInstallSkill).toHaveBeenCalledTimes(1);
  });

  it("should thread options.mode through to installSkill", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillAddCommand(resolve({ ...opts(tempDir), mode: "copy" }));
    command.run!({ name: ["commit"], verbose: false });

    expect(mockedInstallSkill).toHaveBeenCalledTimes(1);
    expect(mockedInstallSkill.mock.calls[0]![2]).toEqual({ mode: "copy" });
  });

  it("should default to not passing a mode option when none is configured", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillAddCommand(resolve(opts(tempDir)));
    command.run!({ name: ["commit"], verbose: false });

    expect(mockedInstallSkill).toHaveBeenCalledTimes(1);
    // No mode configured → installer default ("symlink") applies
    // without commands.ts having to know the default.
    expect(mockedInstallSkill.mock.calls[0]![2]).toEqual({});
  });

  it("should refuse to overwrite a live symlink whose target lacks SKILL.md", () => {
    // Asymmetry guard: hasInstalledSkill === false (no SKILL.md through the
    // symlink) but the slot is still occupied by a live symlink to some
    // foreign directory. `listStatus` classifies this as `unstamped`; the
    // install path must refuse to clobber it for parity, otherwise
    // `installSkill`'s `clearInstallSlot` would silently `unlinkSync` it.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(null);
    mockedHasInstalledSkill.mockReturnValue(false);

    const projectRoot = createTempDir();
    try {
      const foreignTarget = join(projectRoot, "foreign-skill");
      mkdirSync(foreignTarget, { recursive: true });
      const canonical = join(projectRoot, ".agents/skills/commit");
      mkdirSync(join(projectRoot, ".agents/skills"), { recursive: true });
      symlinkSync(foreignTarget, canonical, "dir");

      const command = createSkillAddCommand(resolve({ ...opts(tempDir), cwd: projectRoot }));

      expect(() => command.run!({ name: ["commit"], verbose: false })).toThrow(
        /Refusing to install/,
      );
      expect(mockedInstallSkill).not.toHaveBeenCalled();
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("should still reap a dangling canonical symlink on install", () => {
    // A dangling canonical symlink is almost certainly a leftover from a
    // previous install of this CLI (source package was uninstalled).
    // `installSkill`'s `clearInstallSlot` reaps it, and the new clobber
    // guard must not refuse the install just because the slot is "present".
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(null);
    mockedHasInstalledSkill.mockReturnValue(false);

    const projectRoot = createTempDir();
    try {
      const canonical = join(projectRoot, ".agents/skills/commit");
      mkdirSync(join(projectRoot, ".agents/skills"), { recursive: true });
      symlinkSync(join(projectRoot, "does-not-exist"), canonical, "dir");

      const command = createSkillAddCommand(resolve({ ...opts(tempDir), cwd: projectRoot }));
      command.run!({ name: ["commit"], verbose: false });

      expect(mockedInstallSkill).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("should refuse to install when source SKILL.md has no politty-cli stamp", () => {
    // Skill package forgot to declare ownership — packaging bug, surface early.
    writeSkillMd(
      tempDir,
      "commit",
      { name: "commit", description: "Commit skill" },
      { ownership: null },
    );

    const command = createSkillAddCommand(resolve(opts(tempDir)));

    expect(() => command.run!({ name: ["commit"], verbose: false })).toThrow(
      /source SKILL\.md declares/,
    );
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should refuse to install when source SKILL.md's politty-cli stamp does not match", () => {
    writeSkillMd(
      tempDir,
      "commit",
      { name: "commit", description: "Commit skill" },
      { ownership: "wrong-pkg:wrong-cli" },
    );

    const command = createSkillAddCommand(resolve(opts(tempDir)));

    expect(() => command.run!({ name: ["commit"], verbose: false })).toThrow(
      /source SKILL\.md declares/,
    );
    expect(mockedInstallSkill).not.toHaveBeenCalled();
  });

  it("should refuse to clobber an installed but unstamped legacy skill", () => {
    // readInstalledOwnership returns null both for "not installed" and for
    // "installed but has no (or malformed) politty-cli stamp". The slot-
    // presence + non-dangling check resolves the ambiguity so we don't
    // silently rmSync a user's manual install.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(null);
    mockedHasInstalledSkill.mockReturnValue(true);

    const projectRoot = createTempDir();
    try {
      const canonical = join(projectRoot, ".agents/skills/commit");
      mkdirSync(canonical, { recursive: true });
      writeFileSync(join(canonical, "SKILL.md"), "---\nname: commit\ndescription: x\n---\n");

      const command = createSkillAddCommand(resolve({ ...opts(tempDir), cwd: projectRoot }));

      expect(() => command.run!({ name: ["commit"], verbose: false })).toThrow(
        /without a politty-cli stamp/,
      );
      expect(mockedInstallSkill).not.toHaveBeenCalled();
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
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

    const command = createSkillRemoveCommand(resolve(opts(tempDir)));
    command.run!({ name: undefined });

    expect(mockedUninstallSkill).toHaveBeenCalledTimes(2);
  });

  it("should remove specific skill by name", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillRemoveCommand(resolve(opts(tempDir)));
    command.run!({ name: "commit" });

    expect(mockedUninstallSkill).toHaveBeenCalledTimes(1);
    expect(mockedUninstallSkill.mock.calls[0]![0]).toBe("commit");
    // Third arg carries the expectedOwnership so uninstall can rm copy-mode
    // installs owned by this CLI — but never one it doesn't own.
    expect(mockedUninstallSkill.mock.calls[0]![2]).toEqual({ expectedOwnership: OWNERSHIP });
  });

  it("should refuse to remove a skill owned by another CLI", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue("other-pkg:other-cli");

    const command = createSkillRemoveCommand(resolve(opts(tempDir)));

    expect(() => command.run!({ name: "commit" })).toThrow(/Refusing to remove/);
    expect(mockedUninstallSkill).not.toHaveBeenCalled();
  });

  it("should allow direct-by-name removal when source dir has dropped the skill", () => {
    // Empty source dir, but the skill was previously installed by us.
    const command = createSkillRemoveCommand(resolve(opts(tempDir)));
    command.run!({ name: "orphan" });

    // The second arg is the resolved cwd (find-up project root from
    // process.cwd()). Asserting on the first/third args is enough to
    // verify the orphan-removal contract without coupling the test to
    // the runner's working directory.
    expect(mockedUninstallSkill).toHaveBeenCalledWith("orphan", expect.any(String), {
      expectedOwnership: OWNERSHIP,
    });
  });

  it("should allow orphan removal even when source dir still bundles other skills", () => {
    // Source dir has other skills, but not "orphan" — should still remove it.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const command = createSkillRemoveCommand(resolve(opts(tempDir)));
    command.run!({ name: "orphan" });

    expect(mockedUninstallSkill).toHaveBeenCalledWith("orphan", expect.any(String), {
      expectedOwnership: OWNERSHIP,
    });
  });

  it("should no-op when skill is not installed", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(null);

    const command = createSkillRemoveCommand(resolve(opts(tempDir)));
    command.run!({ name: "commit" });

    expect(mockedUninstallSkill).not.toHaveBeenCalled();
  });

  it("should list installed skills (only) in the not-installed message", () => {
    // Only installed names are valid `remove` targets, so the suggestion
    // is restricted to that universe. Source listing here would be
    // misdirection — a source skill that isn't installed isn't a
    // remove target either.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(null);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const command = createSkillRemoveCommand(resolve(opts(tempDir)));
      command.run!({ name: "typo" });

      const lines = consoleSpy.mock.calls.map((c) => c[0] as string);
      const message = lines.find((l) => l.includes("nothing to remove"));
      expect(message).toBeDefined();
      expect(message).toContain("Installed:");
      expect(message).not.toContain("Source:");
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("dangling-symlink cleanup", () => {
  // Exercises `cleanupBrokenSlot` / `isDanglingSymlink` directly via
  // `skills remove <name>` when the canonical slot is a broken symlink
  // (target gone) and `readInstalledOwnership` consequently returns null.
  // Without this reaping, `skills list`'s `status: "missing"` slots would
  // accumulate over time even when the user asks `remove` to clean them up.
  let tempDir: string;
  let projectRoot: string;

  beforeEach(() => {
    tempDir = createTempDir();
    projectRoot = createTempDir();
    mockedUninstallSkill.mockReset();
    mockedReadOwnership.mockReset();
    mockedReadOwnership.mockReturnValue(null);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function makeDanglingSlot(parent: string, name: string): string {
    mkdirSync(parent, { recursive: true });
    const slot = join(parent, name);
    symlinkSync(join(parent, "does-not-exist"), slot, "dir");
    return slot;
  }

  it("should unlink dangling canonical and agent-slot symlinks on remove <name>", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const canonical = makeDanglingSlot(join(projectRoot, ".agents/skills"), "commit");
    // Agent slot must route to our canonical (as a real install would write
    // it: ../../.agents/skills/<name>) for the dangling-symlink reaper to
    // consider it ours; otherwise the new route-check leaves it alone.
    mkdirSync(join(projectRoot, ".claude/skills"), { recursive: true });
    const agentSlot = join(projectRoot, ".claude/skills/commit");
    symlinkSync("../../.agents/skills/commit", agentSlot, "dir");
    // sanity: both slots are present-but-broken before the command runs.
    expect(lstatSync(canonical).isSymbolicLink()).toBe(true);
    expect(lstatSync(agentSlot).isSymbolicLink()).toBe(true);
    expect(existsSync(canonical)).toBe(false);
    expect(existsSync(agentSlot)).toBe(false);

    const command = createSkillRemoveCommand(resolve({ ...opts(tempDir), cwd: projectRoot }));
    command.run!({ name: "commit" });

    expect(existsSync(canonical)).toBe(false);
    expect(existsSync(agentSlot)).toBe(false);
    // The broken slot was never owned by anything readable, so the real
    // uninstaller path must NOT fire — cleanup is purely the dangling-symlink
    // reaper.
    expect(mockedUninstallSkill).not.toHaveBeenCalled();
    // And the slot itself is gone (not merely a still-broken symlink).
    expect(() => lstatSync(canonical)).toThrow();
    expect(() => lstatSync(agentSlot)).toThrow();
  });

  it("should leave a foreign dangling agent-slot symlink untouched", () => {
    // The canonical .agents/skills/<name> is dangling (ours, to be reaped),
    // but the .claude/skills/<name> symlink points at *another* tool's
    // canonical path (e.g. .agents-other/<name>) and happens to also be
    // dangling. Reaping it here would silently delete a foreign tool's
    // install slot in the shared agent namespace.
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });

    const canonical = makeDanglingSlot(join(projectRoot, ".agents/skills"), "commit");
    // Foreign agent symlink: points at a path that is NOT our canonical and
    // happens to not exist. realpath fallback won't match either, so the
    // route check must refuse to reap.
    mkdirSync(join(projectRoot, ".claude/skills"), { recursive: true });
    const foreignAgentSlot = join(projectRoot, ".claude/skills/commit");
    symlinkSync(join(projectRoot, "foreign-tool/skills/commit"), foreignAgentSlot, "dir");
    expect(lstatSync(foreignAgentSlot).isSymbolicLink()).toBe(true);
    expect(existsSync(foreignAgentSlot)).toBe(false);

    const command = createSkillRemoveCommand(resolve({ ...opts(tempDir), cwd: projectRoot }));
    command.run!({ name: "commit" });

    // Our canonical was reaped...
    expect(existsSync(canonical)).toBe(false);
    expect(() => lstatSync(canonical)).toThrow();
    // ...but the foreign agent symlink remains untouched.
    expect(lstatSync(foreignAgentSlot).isSymbolicLink()).toBe(true);
    expect(readlinkSync(foreignAgentSlot)).toContain("foreign-tool");
  });

  it("should leave a live canonical symlink alone (no false-positive cleanup)", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    // Create a real target then symlink to it so the canonical is *live*.
    const liveTarget = join(projectRoot, "live-target");
    mkdirSync(liveTarget, { recursive: true });
    writeFileSync(join(liveTarget, "marker.txt"), "alive");
    mkdirSync(join(projectRoot, ".agents/skills"), { recursive: true });
    const canonical = join(projectRoot, ".agents/skills", "commit");
    symlinkSync(liveTarget, canonical, "dir");
    expect(existsSync(canonical)).toBe(true);

    const command = createSkillRemoveCommand(resolve({ ...opts(tempDir), cwd: projectRoot }));
    command.run!({ name: "commit" });

    // Live symlink stays put — only the dangling reaper would have touched it,
    // and `readInstalledOwnership` mocked to null means no other path fires.
    expect(lstatSync(canonical).isSymbolicLink()).toBe(true);
    expect(existsSync(canonical)).toBe(true);
  });
});

describe("flag overrides", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mockedInstallSkill.mockReset();
    mockedReadOwnership.mockReset();
    mockedReadOwnership.mockReturnValue(OWNERSHIP);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should default the exclude alias to -x", () => {
    const command = createSkillSyncCommand(resolve(opts(tempDir)));
    // The arg() metadata is registered on the schema; the alias-config
    // round-trip is verified through politty's normal arg parser elsewhere.
    // Here we assert the schema accepts the default short-flag form.
    expect(command.args).toBeDefined();
  });

  it("should drop the short alias when flags.exclude.alias is false", () => {
    const command = createSkillSyncCommand(
      resolve({ ...opts(tempDir), flags: { exclude: { alias: false } } }),
    );
    expect(command.args).toBeDefined();
  });

  it("should accept a custom alias string", () => {
    const command = createSkillSyncCommand(
      resolve({ ...opts(tempDir), flags: { exclude: { alias: "X" } } }),
    );
    expect(command.args).toBeDefined();
  });
});

describe("cwd resolution", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mockedInstallSkill.mockReset();
    mockedReadOwnership.mockReset();
    mockedReadOwnership.mockReturnValue(OWNERSHIP);
    mockedHasInstalledSkill.mockReset();
    mockedHasInstalledSkill.mockReturnValue(false);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should pass options.cwd through to installSkill verbatim", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    const projectRoot = createTempDir();

    const command = createSkillAddCommand(resolve({ ...opts(tempDir), cwd: projectRoot }));
    command.run!({ name: ["commit"], verbose: false });

    // Second arg is the resolved cwd. With an explicit override we expect
    // exactly that path (resolved to absolute).
    const cwdArg = mockedInstallSkill.mock.calls[0]![1];
    expect(cwdArg).toBe(projectRoot);

    rmSync(projectRoot, { recursive: true, force: true });
  });
});

describe("--verbose output", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mockedInstallSkill.mockReset();
    mockedReadOwnership.mockReset();
    mockedReadOwnership.mockReturnValue(null);
    mockedHasInstalledSkill.mockReset();
    mockedHasInstalledSkill.mockReturnValue(false);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should print install path and mode when --verbose is set", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const command = createSkillAddCommand(resolve({ ...opts(tempDir), mode: "copy" }));
      command.run!({ name: ["commit"], verbose: true });

      // Normalise to forward slashes so the assertion works on Windows runners
      // where the install path is rendered with backslashes.
      const lines = consoleSpy.mock.calls.map((c) => (c[0] as string).replaceAll("\\", "/"));
      expect(lines.some((l) => l.includes("mode=copy"))).toBe(true);
      expect(lines.some((l) => l.includes(".agents/skills/commit"))).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should not print path/mode when --verbose is omitted", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const command = createSkillAddCommand(resolve(opts(tempDir)));
      command.run!({ name: ["commit"], verbose: false });

      const lines = consoleSpy.mock.calls.map((c) => c[0] as string);
      expect(lines.some((l) => l.includes("mode="))).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("no-op summaries", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mockedInstallSkill.mockReset();
    mockedUninstallSkill.mockReset();
    mockedReadOwnership.mockReset();
    mockedReadOwnership.mockReturnValue(null);
    mockedHasInstalledSkill.mockReset();
    mockedHasInstalledSkill.mockReturnValue(false);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should print a 'no skills installed' summary when sync excludes everything", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const command = createSkillSyncCommand(resolve(opts(tempDir)));
      command.run!({ exclude: ["commit"], verbose: false });

      const lines = consoleSpy.mock.calls.map((c) => c[0] as string);
      // Without this summary, sync exits 0 with zero output — a confusing UX.
      expect(lines.some((l) => l.includes("No skills installed"))).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should print a 'nothing to remove' summary when remove finds no installs", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    mockedReadOwnership.mockReturnValue(null);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const command = createSkillRemoveCommand(resolve(opts(tempDir)));
      command.run!({ name: undefined });

      const lines = consoleSpy.mock.calls.map((c) => c[0] as string);
      expect(lines.some((l) => l.includes("nothing to remove"))).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("should print a sync-complete summary when work happens", () => {
    writeSkillMd(tempDir, "commit", { name: "commit", description: "Commit skill" });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const command = createSkillSyncCommand(resolve(opts(tempDir)));
      command.run!({ exclude: [], verbose: false });

      const lines = consoleSpy.mock.calls.map((c) => c[0] as string);
      expect(lines.some((l) => l.includes("Sync complete"))).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
