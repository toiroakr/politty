import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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

  it("should produce a working install when the project path traverses a symlink shortcut", () => {
    // Contract test: a project root reached via a symlink (macOS `/tmp →
    // /private/tmp`, a symlinked checkout, a pnpm shortcut, etc.) must
    // still produce dereferenceable canonical and agent slots. The
    // installer realpaths both endpoints when computing the link, so the
    // relative target stays self-consistent and the resolved slot reads
    // back the source content.
    const realDeepDir = join(
      tmpdir(),
      `politty-deep-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      "a",
      "b",
      "c",
    );
    mkdirSync(realDeepDir, { recursive: true });
    const shortcut = join(
      tmpdir(),
      `politty-short-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    symlinkSync(realDeepDir, shortcut, "dir");
    try {
      const skill = createSkillFixture(sourceDir, "commit");

      installSkill(skill, shortcut);

      const canonicalContent = readFileSync(
        join(shortcut, ".agents/skills/commit/SKILL.md"),
        "utf-8",
      );
      expect(canonicalContent).toContain("name: commit");
      const agentContent = readFileSync(join(shortcut, ".claude/skills/commit/SKILL.md"), "utf-8");
      expect(agentContent).toContain("name: commit");
    } finally {
      unlinkSync(shortcut);
      rmSync(resolve(realDeepDir, "..", "..", ".."), { recursive: true, force: true });
    }
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

  it("should refuse to replace a foreign symlink at .claude/skills/<name>", () => {
    // Another tool installed at the same agent path with a symlink to its
    // own canonical. populateAgentDirs's clearInstallSlot must not silently
    // unlink that symlink — refuse like the real-directory case.
    const foreignTarget = join(projectDir, "foreign-tool/skills/commit");
    mkdirSync(foreignTarget, { recursive: true });
    writeFileSync(
      join(foreignTarget, "SKILL.md"),
      '---\nname: commit\ndescription: foreign\nmetadata:\n  politty-cli: "other:tool"\n---\n',
    );
    const claudeSlot = join(projectDir, ".claude/skills/commit");
    mkdirSync(dirname(claudeSlot), { recursive: true });
    symlinkSync(foreignTarget, claudeSlot, "dir");

    const skill = createSkillFixture(sourceDir, "commit");

    expect(() => installSkill(skill, projectDir)).toThrow(/Refusing to replace symlink/);
    expect(lstatSync(claudeSlot).isSymbolicLink()).toBe(true);
    expect(realpathSync(claudeSlot)).toBe(realpathSync(foreignTarget));
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

  it("should refuse to recurse into a directory symlink cycle in copy mode", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    // Create a directory symlink inside the source that resolves back to
    // the skill directory itself, forming a cycle. Without cycle detection
    // copyDirRecursive would recurse until the stack overflows.
    symlinkSync(skill.sourcePath, join(skill.sourcePath, "loop"), "dir");

    expect(() => installSkill(skill, projectDir, { mode: "copy" })).toThrow(/cyclic/i);
  });

  it("should leave no partial canonical slot when a copy-mode install fails mid-copy", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    // Cyclic symlink forces `copyDirRecursive` to throw partway through.
    // Without the staging-and-rename in `atomicCopyDir`, the canonical slot
    // would be left as a real directory (possibly without SKILL.md depending
    // on readdir order). `clearInstallSlot` on the retry would then see an
    // unstamped real directory and refuse to replace it, stranding the
    // install — breaking the documented "re-running converges" guarantee.
    symlinkSync(skill.sourcePath, join(skill.sourcePath, "loop"), "dir");

    expect(() => installSkill(skill, projectDir, { mode: "copy" })).toThrow(/cyclic/i);

    expect(existsSync(join(projectDir, ".agents/skills/commit"))).toBe(false);
    // And no `*.partial-*` staging siblings were left behind either: a future
    // install must not have to clean up garbage from the failed attempt.
    const skillsDir = join(projectDir, ".agents/skills");
    const siblings = existsSync(skillsDir) ? readdirSync(skillsDir) : [];
    expect(siblings).toEqual([]);
  });

  it("should converge on retry after a failed copy-mode install", () => {
    const skill = createSkillFixture(sourceDir, "commit");
    symlinkSync(skill.sourcePath, join(skill.sourcePath, "loop"), "dir");

    expect(() => installSkill(skill, projectDir, { mode: "copy" })).toThrow(/cyclic/i);

    // Removing the cycle and retrying must succeed: the prior failed install
    // must not have left a stamp-less partial directory at the canonical
    // slot that `clearInstallSlot` would later refuse to replace.
    unlinkSync(join(skill.sourcePath, "loop"));
    installSkill(skill, projectDir, { mode: "copy" });
    expect(lstatSync(join(projectDir, ".agents/skills/commit")).isDirectory()).toBe(true);
    expect(readFileSync(join(projectDir, ".agents/skills/commit/SKILL.md"), "utf-8")).toContain(
      "name: commit",
    );
  });

  it("should refuse a copy-mode install without an ownership stamp", () => {
    // Without a stamp on the source SKILL.md, `clearInstallSlot` can never
    // match its `expectedStamp` on a re-install. The first install would
    // succeed and every subsequent one would throw
    // "Refusing to replace non-symlink…" with no actionable hint. Fail fast
    // up-front with a message that names the missing field.
    const skill = createSkillFixture(sourceDir, "noowner", null);

    expect(() => installSkill(skill, projectDir, { mode: "copy" })).toThrow(
      /copy mode without an ownership stamp/i,
    );
    // And nothing was written to the install root.
    expect(() => lstatSync(join(projectDir, ".agents/skills/noowner"))).toThrow();
  });

  it("should refuse a copy-mode install whose source contains the install root", () => {
    // Single-skill source where `sourcePath` *is* the install cwd. The copy
    // mode would mkdir the destination inside the source, then walk the
    // source — including the freshly-created destination — and recurse until
    // the path/disk limit is hit. The overlap guard fails fast.
    writeFileSync(
      join(projectDir, "SKILL.md"),
      `---\nname: commit\ndescription: Test skill\nmetadata:\n  politty-cli: ${JSON.stringify(OWNERSHIP)}\n---\n# commit\n`,
    );
    const skill: DiscoveredSkill = {
      frontmatter: {
        name: "commit",
        description: "Test skill",
        metadata: { "politty-cli": OWNERSHIP },
      },
      sourcePath: projectDir,
      rawContent: "",
    };

    expect(() => installSkill(skill, projectDir, { mode: "copy" })).toThrow(
      /overlaps install destination/i,
    );
    // Nothing committed: the canonical slot must not exist, and crucially
    // neither `.agents/skills/` nor `.claude/skills/` should have been
    // mkdir'd inside the source tree. The overlap pre-check fires before
    // any destination parent is materialised.
    expect(() => lstatSync(join(projectDir, ".agents/skills/commit"))).toThrow();
    expect(() => lstatSync(join(projectDir, ".agents/skills"))).toThrow();
    expect(() => lstatSync(join(projectDir, ".claude/skills"))).toThrow();
  });

  it("should refuse a symlink-mode install whose source sits at an agent slot", () => {
    // Symlink mode with `sourcePath = projectDir/.claude/skills/<name>` would
    // pass the canonical check (canonicalDir is at `.agents/skills/<name>`,
    // distinct from the source). But `populateAgentDirs` then iterates
    // `SYMLINK_TARGETS`, hits `.claude/skills/<name>` (== source), matches
    // the stamp, and rm-rf's the source out from under the install. The
    // expanded overlap guard refuses up-front instead.
    const agentSlotParent = join(projectDir, ".claude/skills");
    mkdirSync(agentSlotParent, { recursive: true });
    const agentSlot = join(agentSlotParent, "commit");
    mkdirSync(agentSlot);
    writeFileSync(
      join(agentSlot, "SKILL.md"),
      `---\nname: commit\ndescription: Test skill\nmetadata:\n  politty-cli: ${JSON.stringify(OWNERSHIP)}\n---\n# commit\n`,
    );
    const skill: DiscoveredSkill = {
      frontmatter: {
        name: "commit",
        description: "Test skill",
        metadata: { "politty-cli": OWNERSHIP },
      },
      sourcePath: agentSlot,
      rawContent: "",
    };

    expect(() => installSkill(skill, projectDir, { mode: "symlink" })).toThrow(
      /overlaps install destination/i,
    );
    // The source is still intact — no rm-rf reached it.
    expect(existsSync(join(agentSlot, "SKILL.md"))).toBe(true);
  });

  it("should refuse an install whose source sits inside a sibling whose name starts with '..'", () => {
    // Boundary regression: the overlap check used `relative(...).startsWith("..")`
    // to decide "outside", which misclassifies a child directory whose own name
    // begins with `..` (e.g. `..backup`) as outside the canonical install slot.
    // The buggy version would miss the containment, then `clearInstallSlot`
    // would rm-rf the canonical slot — taking the source with it. With the
    // boundary-aware check, only literal `..` and `..<sep>...` are escapes.
    const canonicalParent = join(projectDir, ".agents/skills/commit");
    const sourceDir = join(canonicalParent, "..backup");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, "SKILL.md"),
      `---\nname: commit\ndescription: Test skill\nmetadata:\n  politty-cli: ${JSON.stringify(OWNERSHIP)}\n---\n# commit\n`,
    );
    const skill: DiscoveredSkill = {
      frontmatter: {
        name: "commit",
        description: "Test skill",
        metadata: { "politty-cli": OWNERSHIP },
      },
      sourcePath: sourceDir,
      rawContent: "",
    };

    expect(() => installSkill(skill, projectDir, { mode: "symlink" })).toThrow(
      /overlaps install destination/i,
    );
    expect(existsSync(join(sourceDir, "SKILL.md"))).toBe(true);
  });

  it("should preserve a package-manager source symlink in the canonical link target", () => {
    // pnpm structure: `node_modules/<pkg>` is a symlink into
    // `node_modules/.pnpm/<pkg>@<version>_<hash>/node_modules/<pkg>`. The
    // hash path is volatile — a `pnpm update` swaps it for a different
    // hash. If the installer realpath's the source, it bakes the volatile
    // hash path into `.agents/skills/<name>`'s link target and the next
    // update leaves every install dangling. The installer must keep the
    // source lexical so the canonical link target stays at the stable
    // `node_modules/<pkg>/...` path that pnpm keeps updating.
    const pnpmDir = join(projectDir, "node_modules", ".pnpm");
    const versionedDir = join(pnpmDir, "my-pkg@1.0.0_abc123", "node_modules", "my-pkg");
    const skillSourceUnderVersioned = join(versionedDir, "skills", "commit");
    mkdirSync(skillSourceUnderVersioned, { recursive: true });
    writeFileSync(
      join(skillSourceUnderVersioned, "SKILL.md"),
      `---\nname: commit\ndescription: Test\nmetadata:\n  politty-cli: ${JSON.stringify(OWNERSHIP)}\n---\n# commit\n`,
    );
    const pkgSymlink = join(projectDir, "node_modules", "my-pkg");
    symlinkSync(join(".pnpm", "my-pkg@1.0.0_abc123", "node_modules", "my-pkg"), pkgSymlink, "dir");

    const skill: DiscoveredSkill = {
      frontmatter: {
        name: "commit",
        description: "Test",
        metadata: { "politty-cli": OWNERSHIP },
      },
      // Source path traverses the pnpm `node_modules/<pkg>` symlink. The
      // installer is invoked with this lexical path (as the discovery
      // scanner would produce).
      sourcePath: join(projectDir, "node_modules", "my-pkg", "skills", "commit"),
      rawContent: "",
    };

    installSkill(skill, projectDir);

    const canonicalSlot = join(projectDir, ".agents/skills/commit");
    const linkTarget = readlinkSync(canonicalSlot);
    // The link target must route through the stable `node_modules/my-pkg`
    // path, never the volatile `.pnpm/<hash>` realpath.
    expect(linkTarget).toContain(join("node_modules", "my-pkg"));
    expect(linkTarget).not.toContain(".pnpm");
    expect(linkTarget).not.toContain("abc123");

    // Simulate `pnpm update`: the hashed directory name changes and
    // `node_modules/my-pkg` is repointed at the new version. The install
    // must still resolve because the lexical link target tracks the stable
    // `node_modules/my-pkg` hop.
    const newVersionedDir = join(pnpmDir, "my-pkg@1.0.1_xyz789", "node_modules", "my-pkg");
    const newSkillSource = join(newVersionedDir, "skills", "commit");
    mkdirSync(newSkillSource, { recursive: true });
    writeFileSync(
      join(newSkillSource, "SKILL.md"),
      `---\nname: commit\ndescription: Updated\nmetadata:\n  politty-cli: ${JSON.stringify(OWNERSHIP)}\n---\n# commit v1.0.1\n`,
    );
    unlinkSync(pkgSymlink);
    symlinkSync(join(".pnpm", "my-pkg@1.0.1_xyz789", "node_modules", "my-pkg"), pkgSymlink, "dir");
    rmSync(join(pnpmDir, "my-pkg@1.0.0_abc123"), { recursive: true, force: true });

    // Reading the SKILL.md through the canonical slot now picks up the
    // updated content via the unchanged canonical link target.
    const content = readFileSync(join(canonicalSlot, "SKILL.md"), "utf-8");
    expect(content).toContain("Updated");
    expect(content).toContain("commit v1.0.1");
  });

  it("should dereference a symlinked checkout while preserving the pnpm hop", () => {
    // Combined hazard: cwd is reached through a project-root symlink
    // (e.g. a developer shortcut, or pnpm's own `node_modules/<pkg>/...`
    // hop above the install root) AND the source path traverses pnpm's
    // versioned `node_modules/<pkg>` symlink. A purely lexical source
    // would write a relative link target that routes back through the
    // project-root symlink — moving/copying the project then breaks the
    // install despite the documented portability guarantee. The asymmetric
    // source resolver must dereference the project-root portion (so the
    // relative link target lives in the same realpath style as
    // `resolvedParent`) while still preserving the `node_modules/<pkg>`
    // hop so `pnpm update` doesn't strand the install.
    const realProjectDir = join(
      tmpdir(),
      `politty-real-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(realProjectDir, { recursive: true });
    const shortcutDir = join(
      tmpdir(),
      `politty-shortcut-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    symlinkSync(realProjectDir, shortcutDir, "dir");
    try {
      const pnpmDir = join(realProjectDir, "node_modules", ".pnpm");
      const versionedDir = join(pnpmDir, "my-pkg@1.0.0_abc123", "node_modules", "my-pkg");
      const skillSourceUnderVersioned = join(versionedDir, "skills", "commit");
      mkdirSync(skillSourceUnderVersioned, { recursive: true });
      writeFileSync(
        join(skillSourceUnderVersioned, "SKILL.md"),
        `---\nname: commit\ndescription: Test\nmetadata:\n  politty-cli: ${JSON.stringify(OWNERSHIP)}\n---\n# commit\n`,
      );
      const pkgSymlink = join(realProjectDir, "node_modules", "my-pkg");
      symlinkSync(
        join(".pnpm", "my-pkg@1.0.0_abc123", "node_modules", "my-pkg"),
        pkgSymlink,
        "dir",
      );

      const skill: DiscoveredSkill = {
        frontmatter: {
          name: "commit",
          description: "Test",
          metadata: { "politty-cli": OWNERSHIP },
        },
        // Source path reaches the source via the shortcut — same lexical
        // prefix the scanner would emit when cwd is the shortcut.
        sourcePath: join(shortcutDir, "node_modules", "my-pkg", "skills", "commit"),
        rawContent: "",
      };

      installSkill(skill, shortcutDir);

      const canonicalSlot = join(realProjectDir, ".agents/skills/commit");
      const linkTarget = readlinkSync(canonicalSlot);
      // The pnpm hop must survive (so `pnpm update` doesn't break the
      // install) and the shortcut symlink must NOT appear (so a copy of
      // `realProjectDir` is self-contained).
      expect(linkTarget).toContain(join("node_modules", "my-pkg"));
      expect(linkTarget).not.toContain(".pnpm");
      expect(linkTarget).not.toContain("abc123");
      expect(linkTarget).not.toContain(basename(shortcutDir));

      // The install reads back through the unchanged canonical/pnpm path.
      const content = readFileSync(join(canonicalSlot, "SKILL.md"), "utf-8");
      expect(content).toContain("name: commit");
    } finally {
      unlinkSync(shortcutDir);
      rmSync(realProjectDir, { recursive: true, force: true });
    }
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

  it("should leave a foreign symlink at an agent slot untouched", () => {
    // Another tool symlinked .claude/skills/commit to its own canonical
    // path. Our uninstall of the canonical .agents/skills/commit must not
    // also unlink that foreign symlink — agent slots are a shared
    // namespace, and routing-to-our-canonical is the only safe trigger.
    const skill = createSkillFixture(sourceDir, "commit");
    installSkill(skill, projectDir);

    const foreignTarget = join(projectDir, "foreign-tool/skills/commit");
    mkdirSync(foreignTarget, { recursive: true });
    const claudeSlot = join(projectDir, ".claude/skills/commit");
    // Replace our agent-slot symlink with a foreign one pointing elsewhere.
    unlinkSync(claudeSlot);
    symlinkSync(foreignTarget, claudeSlot, "dir");

    uninstallSkill("commit", projectDir, { expectedOwnership: OWNERSHIP });

    expect(existsSync(join(projectDir, ".agents/skills/commit"))).toBe(false);
    // Foreign symlink must remain so the other tool's install is intact.
    expect(lstatSync(claudeSlot).isSymbolicLink()).toBe(true);
    expect(realpathSync(claudeSlot)).toBe(realpathSync(foreignTarget));
  });

  it("should leave a foreign canonical symlink untouched when expectedOwnership mismatches", () => {
    // Another politty-based CLI installed a skill of the same name at
    // .agents/skills/<name>, pointing at its own source carrying a
    // *different* stamp. Calling uninstallSkill with our expectedOwnership
    // must not unlink that foreign canonical symlink: the shared
    // .agents/skills/ namespace is gated on the stamp.
    const foreignSource = createTempDir();
    try {
      const foreignSkillDir = join(foreignSource, "commit");
      mkdirSync(foreignSkillDir, { recursive: true });
      writeFileSync(
        join(foreignSkillDir, "SKILL.md"),
        `---\nname: commit\ndescription: Foreign skill\nmetadata:\n  politty-cli: "other-pkg:other-cli"\n---\n# commit\n`,
      );
      mkdirSync(join(projectDir, ".agents/skills"), { recursive: true });
      const canonicalSlot = join(projectDir, ".agents/skills/commit");
      symlinkSync(foreignSkillDir, canonicalSlot, "dir");

      uninstallSkill("commit", projectDir, { expectedOwnership: OWNERSHIP });

      // Foreign canonical symlink must remain — its stamp does not match
      // OWNERSHIP, so it belongs to another CLI in the shared namespace.
      expect(lstatSync(canonicalSlot).isSymbolicLink()).toBe(true);
      expect(realpathSync(canonicalSlot)).toBe(realpathSync(foreignSkillDir));
    } finally {
      rmSync(foreignSource, { recursive: true, force: true });
    }
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
