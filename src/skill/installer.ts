import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type { DiscoveredSkill } from "./types.js";

/** Canonical directory where skill files are stored. */
export const AGENTS_SKILLS_DIR = ".agents/skills";

/**
 * Agent directories that get symlinks to the canonical skill directory.
 * Universal agents (Cursor, Cline, etc.) read from .agents/skills/ directly.
 */
const SYMLINK_TARGETS = [".claude/skills"] as const;

/**
 * Key used to read provenance off an installed skill. The SKILL.md's
 * `metadata["politty-cli"]` must equal `"{packageName}:{cliName}"` for the
 * owning CLI to manage it. This stamp is authored by the skill package,
 * not rewritten at install time.
 */
export const OWNERSHIP_METADATA_KEY = "politty-cli";

/**
 * Defense-in-depth check against path traversal. Skill names are also
 * validated by the frontmatter schema, but we re-validate here in case a
 * caller bypasses it.
 */
function assertSafeName(name: string): void {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Invalid skill name: ${JSON.stringify(name)}`);
  }
}

/**
 * Install a skill to the project's agent skill directories as a symlink.
 *
 * Canonical `.agents/skills/<name>` becomes a symlink to `skill.sourcePath`
 * (typically `node_modules/<pkg>/skills/<name>`), and each agent-specific
 * directory in `SYMLINK_TARGETS` gets a symlink to the canonical path.
 * Updates to the source propagate live — no staging, no copy, no
 * re-stamping. Symlink failures are surfaced as errors rather than
 * silently falling back to copy.
 *
 * The ownership stamp (`metadata["politty-cli"]`) is authored by the skill
 * package; the installer does not modify SKILL.md.
 */
export function installSkill(skill: DiscoveredSkill, cwd: string = process.cwd()): void {
  const name = skill.frontmatter.name;
  assertSafeName(name);

  const canonicalParent = resolve(cwd, AGENTS_SKILLS_DIR);
  mkdirSync(canonicalParent, { recursive: true });

  const canonicalDir = join(canonicalParent, name);
  prepareSymlinkSlot(canonicalDir);
  // Use realpath of both endpoints so the relative link stays correct when
  // either the agent dir or the project path includes symlink components
  // (e.g. CLI invoked from a symlinked checkout).
  const resolvedParent = realpathSync(canonicalParent);
  const resolvedSource = realpathSync(skill.sourcePath);
  symlinkSync(relative(resolvedParent, resolvedSource), canonicalDir, "dir");

  populateAgentDirs(cwd, name, canonicalDir);
}

/**
 * Uninstall a skill from the project's agent skill directories.
 *
 * Removes symlinks from agent directories, then removes the canonical symlink.
 * A real directory at any of those paths means it wasn't installed by us
 * (legacy/manual install) — we leave it alone rather than recursively
 * deleting user data the CLI has no claim to. Ownership validation is the
 * caller's responsibility (`removeOwnedSkill` handles it for the CLI flow).
 */
export function uninstallSkill(name: string, cwd: string = process.cwd()): void {
  assertSafeName(name);

  for (const target of SYMLINK_TARGETS) {
    removeSymlinkOnly(resolve(cwd, target, name));
  }
  removeSymlinkOnly(resolve(cwd, AGENTS_SKILLS_DIR, name));
}

/**
 * Unlink `path` iff it is a symlink. No-op when absent or when the path
 * is a real file/directory. A real directory means the path was installed
 * outside this CLI; we leave it alone rather than recursively rm'ing it.
 *
 * `unlinkSync` (not `rmSync`) is required for symlinks to directories —
 * `rmSync` without `recursive: true` errors "Path is a directory" on a
 * dir-symlink, but passing `recursive: true` would follow the symlink and
 * delete its target contents.
 */
function removeSymlinkOnly(path: string): void {
  if (!isSymlink(path)) return;
  unlinkSync(path);
}

/**
 * Clear a slot so a new symlink can be created at `path`.
 *
 * - Absent → no-op.
 * - Symlink (live or broken) → unlink.
 * - Real file/directory → throw, refusing to clobber user data.
 *
 * Install flows call this before `symlinkSync` instead of the previous
 * `rmSync(recursive)` so a legacy or manual install at `.agents/skills/<name>`
 * or `.claude/skills/<name>` isn't silently recursively deleted.
 */
function prepareSymlinkSlot(path: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) {
    unlinkSync(path);
    return;
  }
  throw new Error(
    `Refusing to replace non-symlink path at ${path}. ` +
      `This looks like a legacy or manual install; remove or migrate it before retrying.`,
  );
}

/**
 * Report whether a skill is currently installed, independent of its
 * ownership stamp. Returns `true` when `.agents/skills/<name>/SKILL.md`
 * resolves to a readable file (through a valid symlink or directly);
 * returns `false` when the path is absent or the canonical symlink is
 * broken (source package uninstalled).
 *
 * Callers use this to distinguish the two cases where
 * {@link readInstalledOwnership} returns `null` — "not installed" (safe
 * to install fresh) vs. "installed but unstamped" (legacy or manual
 * install that should not be silently clobbered).
 */
export function hasInstalledSkill(name: string, cwd: string = process.cwd()): boolean {
  assertSafeName(name);
  return existsSync(resolve(cwd, AGENTS_SKILLS_DIR, name, "SKILL.md"));
}

/**
 * Read the ownership stamp off an installed skill's SKILL.md, if any.
 *
 * Because `.agents/skills/<name>` is a symlink to the source, this reads
 * the stamp authored by the skill package.
 *
 * @returns `metadata["politty-cli"]` as `"{packageName}:{cliName}"`, or
 *   `null` if the skill is not installed *or* the stamp is absent/malformed.
 *   Use {@link hasInstalledSkill} to distinguish the two cases.
 */
export function readInstalledOwnership(name: string, cwd: string = process.cwd()): string | null {
  assertSafeName(name);
  const path = resolve(cwd, AGENTS_SKILLS_DIR, name, "SKILL.md");
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (err) {
    // Treat a missing file/path as "no ownership" — this also covers a
    // broken canonical symlink (source package uninstalled), which surfaces
    // as ENOENT/ENOTDIR. Surface anything else (e.g. EACCES, EPERM) so a
    // real error doesn't look like an unstamped skill and get silently
    // clobbered by `remove`/`sync`.
    if (isNodeError(err) && (err.code === "ENOENT" || err.code === "ENOTDIR")) return null;
    throw err;
  }
  const { data } = parseFrontmatter(content);
  const metadata = (data as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[OWNERSHIP_METADATA_KEY];
  return typeof value === "string" ? value : null;
}

/**
 * Create symlinks from each agent-specific directory to the canonical
 * skill directory. The old link is removed before the new one is created,
 * so the agent path is briefly absent during the swap.
 *
 * `symlink` failure (e.g. Windows without Developer Mode) is propagated
 * as-is — no copy fallback. Users on platforms without symlink support
 * must resolve the underlying permission before `skills` commands can
 * proceed.
 */
function populateAgentDirs(cwd: string, name: string, canonicalDir: string): void {
  for (const target of SYMLINK_TARGETS) {
    const targetParent = resolve(cwd, target);
    mkdirSync(targetParent, { recursive: true });

    const targetDir = join(targetParent, name);
    prepareSymlinkSlot(targetDir);

    // realpath the PARENT directories only. Resolving `canonicalDir` itself
    // would dereference it to the source path, baking the source location
    // into every agent link; the agent link should route through the
    // canonical symlink instead so a single `skills sync` replaces both
    // hops at once.
    const resolvedTargetParent = realpathSync(targetParent);
    const resolvedCanonicalParent = realpathSync(resolve(canonicalDir, ".."));
    const linkTarget = join(relative(resolvedTargetParent, resolvedCanonicalParent), name);
    symlinkSync(linkTarget, targetDir, "dir");
  }
}

/** Detects a path that is a symlink (even if its target is broken). */
function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && typeof (err as NodeJS.ErrnoException).code === "string";
}
