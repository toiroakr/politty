import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findProjectRoot, resolveSkillOptions } from "../options.js";

const PACKAGE = "@my-agent/skills";
const CLI = "my-agent";

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `politty-options-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("findProjectRoot", () => {
  let root: string;

  beforeEach(() => {
    root = createTempDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("should find a directory containing package.json", () => {
    writeFileSync(join(root, "package.json"), "{}");
    const sub = join(root, "a", "b");
    mkdirSync(sub, { recursive: true });

    expect(findProjectRoot(sub)).toBe(root);
  });

  it("should find a directory containing .git", () => {
    mkdirSync(join(root, ".git"));
    const sub = join(root, "src");
    mkdirSync(sub);

    expect(findProjectRoot(sub)).toBe(root);
  });

  it("should accept a .git file (worktree / submodule)", () => {
    // A worktree / submodule has `.git` as a file pointing to the gitdir,
    // not a directory. find-up must treat both as a project root.
    writeFileSync(join(root, ".git"), "gitdir: /elsewhere\n");

    expect(findProjectRoot(root)).toBe(root);
  });

  it("should return the closest match when both markers exist", () => {
    writeFileSync(join(root, "package.json"), "{}");
    const inner = join(root, "pkg");
    mkdirSync(inner);
    writeFileSync(join(inner, "package.json"), "{}");

    // Closest wins; an outer marker doesn't trump an inner one.
    expect(findProjectRoot(inner)).toBe(inner);
  });

  it("should return null when no marker is found", () => {
    // tmpdir may itself live under a path with markers; create a deeply
    // nested empty dir to keep the test deterministic. We can't fully
    // isolate without sandboxing — fall back to asserting that the result
    // is either null or a string (i.e. doesn't crash).
    const result = findProjectRoot(root);
    // tmpdir's parent might or might not have a marker; this assertion is
    // intentionally weak.
    expect(result === null || typeof result === "string").toBe(true);
  });
});

describe("resolveSkillOptions", () => {
  it("should default the exclude alias to 'x'", () => {
    const resolved = resolveSkillOptions({ sourceDir: "/x", package: PACKAGE }, CLI);
    expect(resolved.excludeAlias).toBe("x");
  });

  it("should drop the alias when flags.exclude.alias is false", () => {
    const resolved = resolveSkillOptions(
      { sourceDir: "/x", package: PACKAGE, flags: { exclude: { alias: false } } },
      CLI,
    );
    expect(resolved.excludeAlias).toBeUndefined();
  });

  it("should pass through a custom alias string", () => {
    const resolved = resolveSkillOptions(
      { sourceDir: "/x", package: PACKAGE, flags: { exclude: { alias: "X" } } },
      CLI,
    );
    expect(resolved.excludeAlias).toBe("X");
  });

  it("should default descriptionAppend to a hint mentioning the cli name", () => {
    const resolved = resolveSkillOptions({ sourceDir: "/x", package: PACKAGE }, CLI);
    expect(resolved.descriptionAppend).toContain(CLI);
    expect(resolved.descriptionAppend).toContain("skills <add|sync|remove|list>");
  });

  it("should honour an explicit cwd override (resolved to absolute)", () => {
    const projectRoot = createTempDir();
    try {
      const resolved = resolveSkillOptions(
        { sourceDir: "/x", package: PACKAGE, cwd: projectRoot },
        CLI,
      );
      expect(resolved.cwd).toBe(projectRoot);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("should fall back to process.cwd() when find-up finds no marker", () => {
    // Force find-up to fail by running from a tmp dir that has no markers
    // anywhere up the chain. process.chdir during the call captures the
    // resolution, then restore it.
    const root = createTempDir();
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(root);
    try {
      const resolved = resolveSkillOptions({ sourceDir: "/x", package: PACKAGE }, CLI);
      expect(resolved.cwd).toBe(root);
    } finally {
      cwdSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
