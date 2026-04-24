import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type {
  DiscoveredSkill,
  InstallMode,
  InstallSkillOptions,
  UninstallSkillOptions,
} from "./types.js";

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
 * Install a skill to the project's agent skill directories.
 *
 * Canonical `.agents/skills/<name>` and each `SYMLINK_TARGETS` entry are
 * populated according to `options.mode`:
 *
 * - `"symlink"`: symlink to the source (or to the canonical dir for the
 *   agent-specific slots). Source updates propagate live. Throws on
 *   filesystems without symlink support.
 * - `"copy"`: recursive copy. Works anywhere, but source updates require
 *   re-running install.
 * - `"auto"` (default): try symlink, fall back to copy on `symlinkSync`
 *   failure. Canonical and each agent slot decide independently — a slot
 *   that can symlink will, even if another slot had to copy.
 *
 * The ownership stamp (`metadata["politty-cli"]`) is authored by the skill
 * package; the installer does not modify SKILL.md.
 */
export function installSkill(
  skill: DiscoveredSkill,
  cwd: string = process.cwd(),
  options: InstallSkillOptions = {},
): void {
  const name = skill.frontmatter.name;
  assertSafeName(name);

  const mode: InstallMode = options.mode ?? "auto";
  const expectedStamp = skill.frontmatter.metadata?.[OWNERSHIP_METADATA_KEY] ?? null;

  const canonicalParent = resolve(cwd, AGENTS_SKILLS_DIR);
  mkdirSync(canonicalParent, { recursive: true });

  const canonicalDir = join(canonicalParent, name);
  clearInstallSlot(canonicalDir, expectedStamp);
  // Use realpath of both endpoints so the relative link stays correct when
  // either the agent dir or the project path includes symlink components
  // (e.g. CLI invoked from a symlinked checkout).
  const resolvedParent = realpathSync(canonicalParent);
  const resolvedSource = realpathSync(skill.sourcePath);
  symlinkOrCopy({
    linkTarget: relative(resolvedParent, resolvedSource),
    linkPath: canonicalDir,
    copyFrom: resolvedSource,
    mode,
  });

  populateAgentDirs(cwd, name, canonicalDir, expectedStamp, mode);
}

/**
 * Uninstall a skill from the project's agent skill directories.
 *
 * Symlinks (at any of `.agents/skills/<name>` or `SYMLINK_TARGETS`) are
 * always safe to remove — by construction they were created by an install
 * flow. A real directory at any of those paths is only removed when
 * `options.expectedOwnership` is provided and the directory's SKILL.md
 * carries that ownership stamp (i.e. a copy-mode install this CLI owns).
 * Unstamped or foreign real directories are left alone so that legacy or
 * manual installs are not silently recursively deleted.
 *
 * The `skills remove` / `skills sync` subcommands always pass
 * `expectedOwnership`. Direct programmatic callers get the conservative
 * default (symlinks only).
 */
export function uninstallSkill(
  name: string,
  cwd: string = process.cwd(),
  options: UninstallSkillOptions = {},
): void {
  assertSafeName(name);
  const expected = options.expectedOwnership ?? null;

  for (const target of SYMLINK_TARGETS) {
    removeInstalledSlot(resolve(cwd, target, name), expected);
  }
  removeInstalledSlot(resolve(cwd, AGENTS_SKILLS_DIR, name), expected);
}

/**
 * Remove a previously-installed slot:
 * - Symlink → unlink.
 * - Real directory whose SKILL.md carries `expectedStamp` → rm -rf. This
 *   handles copy-mode installs that share the same canonical path as the
 *   symlink-mode installs.
 * - Anything else (absent, real dir without matching stamp, real file) →
 *   no-op; caller can detect nothing changed by checking after the call.
 *
 * `unlinkSync` (not `rmSync`) is required for symlinks to directories —
 * `rmSync` without `recursive: true` errors "Path is a directory" on a
 * dir-symlink, but passing `recursive: true` would follow the symlink and
 * delete its target contents.
 */
function removeInstalledSlot(path: string, expectedStamp: string | null): void {
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
  if (stat.isDirectory() && expectedStamp !== null && readStampAt(path) === expectedStamp) {
    rmSync(path, { recursive: true, force: true });
  }
}

/**
 * Clear a slot so a new install can occupy `path`.
 *
 * - Absent → no-op.
 * - Symlink (live or broken) → unlink.
 * - Real directory whose SKILL.md carries `expectedStamp` → rm -rf. This
 *   is how a copy-mode install gets replaced in place by another install
 *   (symlink or copy); the ownership check guarantees we are only ever
 *   removing data we previously produced.
 * - Real file or foreign real directory → throw. The ownership guards in
 *   `addSkill` / `removeOwnedSkill` usually prevent this from being
 *   reachable, but a programmatic caller or a hand-made legacy install
 *   surfaces as an actionable error here rather than silent data loss.
 */
function clearInstallSlot(path: string, expectedStamp: string | null): void {
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
  if (stat.isDirectory() && expectedStamp !== null && readStampAt(path) === expectedStamp) {
    rmSync(path, { recursive: true, force: true });
    return;
  }
  throw new Error(
    `Refusing to replace non-symlink path at ${path}. ` +
      `This looks like a legacy or manual install; remove or migrate it before retrying.`,
  );
}

/**
 * Create `linkPath` as a symlink to `linkTarget` when the filesystem
 * supports it, otherwise recursively copy `copyFrom` into `linkPath`.
 *
 * The three modes are independent of one another — a project may end up
 * with the canonical slot as a symlink and an agent slot as a copy, or
 * any other combination. Callers observe only the final on-disk layout.
 */
function symlinkOrCopy(args: {
  linkTarget: string;
  linkPath: string;
  copyFrom: string;
  mode: InstallMode;
}): void {
  const { linkTarget, linkPath, copyFrom, mode } = args;
  if (mode !== "copy") {
    try {
      symlinkSync(linkTarget, linkPath, "dir");
      return;
    } catch (err) {
      if (mode === "symlink") throw err;
      // auto → fall through to copy
    }
  }
  copyDirRecursive(copyFrom, linkPath);
}

/**
 * Recursively copy `src` to `dest` following symlinks (`statSync`, not
 * `lstatSync`). Symlinks in the source are materialised as copies of
 * their target content so the install does not leave dangling references
 * back into `node_modules`. Non-regular files (sockets, devices) are
 * ignored.
 */
function copyDirRecursive(src: string, dest: string): void {
  const stat = statSync(src);
  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      copyDirRecursive(join(src, entry), join(dest, entry));
    }
    return;
  }
  if (stat.isFile()) {
    copyFileSync(src, dest);
  }
}

/**
 * Read the `metadata["politty-cli"]` stamp from a SKILL.md at `<dir>/SKILL.md`.
 * Returns `null` when the file is absent, unreadable, has no frontmatter,
 * or has no string-valued stamp.
 */
function readStampAt(dir: string): string | null {
  let content: string;
  try {
    content = readFileSync(join(dir, "SKILL.md"), "utf-8");
  } catch {
    return null;
  }
  const { data } = parseFrontmatter(content);
  const metadata = (data as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[OWNERSHIP_METADATA_KEY];
  return typeof value === "string" ? value : null;
}

/**
 * Report whether a skill is currently installed, independent of its
 * ownership stamp. Returns `true` when `.agents/skills/<name>/SKILL.md`
 * resolves to a readable file (through a valid symlink or directly, or
 * via a copy-mode install); returns `false` when the path is absent or
 * the canonical symlink is broken (source package uninstalled).
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
 * For symlink-mode installs `.agents/skills/<name>` points at the source,
 * so this reads the package-authored stamp. For copy-mode installs the
 * stamp was captured at install time into the local copy.
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
 * Populate each agent-specific directory so it routes to the canonical
 * install. In symlink-capable filesystems the agent slot is a symlink to
 * `.agents/skills/<name>` so one install swap updates all agent views at
 * once. When `mode` is `"copy"` (or `"auto"` with symlink failure) the
 * slot is a copy of `canonicalDir` instead.
 */
function populateAgentDirs(
  cwd: string,
  name: string,
  canonicalDir: string,
  expectedStamp: string | null,
  mode: InstallMode,
): void {
  for (const target of SYMLINK_TARGETS) {
    const targetParent = resolve(cwd, target);
    mkdirSync(targetParent, { recursive: true });

    const targetDir = join(targetParent, name);
    clearInstallSlot(targetDir, expectedStamp);

    // realpath the PARENT directories only. Resolving `canonicalDir` itself
    // would dereference it to the source path (in symlink mode), baking the
    // source location into every agent link; the agent link should route
    // through the canonical slot instead so a single `skills sync`
    // replaces both hops at once.
    const resolvedTargetParent = realpathSync(targetParent);
    const resolvedCanonicalParent = realpathSync(resolve(canonicalDir, ".."));
    const linkTarget = join(relative(resolvedTargetParent, resolvedCanonicalParent), name);
    symlinkOrCopy({
      linkTarget,
      linkPath: targetDir,
      copyFrom: canonicalDir,
      mode,
    });
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && typeof (err as NodeJS.ErrnoException).code === "string";
}
