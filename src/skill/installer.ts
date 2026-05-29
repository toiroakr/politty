import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
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
 *
 * Exported as the single source of truth shared with `commands.ts`'s
 * dangling-symlink reaper so the two stay in lock-step.
 */
export const SYMLINK_TARGETS = [".claude/skills"] as const;

/**
 * Key used to read provenance off an installed skill. The SKILL.md's
 * `metadata["politty-cli"]` must equal `"{packageName}:{cliName}"` for the
 * owning CLI to manage it. This stamp is authored by the skill package,
 * not rewritten at install time.
 */
export const OWNERSHIP_METADATA_KEY = "politty-cli";

/**
 * Defense-in-depth check against path traversal. Skill names are also
 * validated by the frontmatter schema (1..64 chars, lowercase alphanumerics
 * separated by single hyphens), but we re-validate here in case a caller
 * bypasses it. The 64-char limit is intentionally duplicated rather than
 * imported from frontmatter.ts so this check stays independent.
 */
function assertSafeName(name: string): void {
  if (name.length < 1 || name.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Invalid skill name: ${JSON.stringify(name)}`);
  }
}

/**
 * Install a skill to the project's agent skill directories.
 *
 * Canonical `.agents/skills/<name>` and each `SYMLINK_TARGETS` entry are
 * populated according to `options.mode`:
 *
 * - `"symlink"` (default): symlink to the source (or to the canonical dir
 *   for the agent-specific slots). Source updates propagate live. Throws
 *   with guidance to retry with `"copy"` on filesystems without symlink
 *   support (e.g. Windows without Developer Mode).
 * - `"copy"`: recursive copy. Works anywhere, but source updates require
 *   re-running install.
 *
 * **Symlink target convention.** Symlinks are written with relative
 * targets so an install survives when the project tree is copied or
 * mounted at a different absolute path. The two endpoints are resolved
 * asymmetrically:
 *
 * - The install root (`.agents/skills/`, each `SYMLINK_TARGETS` parent)
 *   is passed through `realpathSync` so a symlinked checkout doesn't
 *   bake a stale parent path into the relative target.
 * - The source path is resolved by {@link resolveSourcePreservingPackageHop},
 *   which walks root→leaf dereferencing every ancestor symlink (a symlinked
 *   checkout, macOS `/tmp` → `/private/tmp`, etc.) like `realpathSync` would
 *   — EXCEPT a `node_modules/<pkg>` (or `node_modules/@scope/<pkg>`)
 *   symlink, which is preserved. Following the package-manager hop would
 *   bake pnpm's volatile `node_modules/.pnpm/<pkg>@<version>_<hash>/...`
 *   into the link target and a subsequent `pnpm update` would leave every
 *   install dangling. Keeping the hop preserves the stable
 *   `node_modules/<pkg>` symlink that pnpm keeps repointing, while the
 *   project-root portion still matches the install root's realpath style
 *   so the install survives copying or remounting the project tree.
 *
 * The overlap guard and copy-mode payload still use the *fully*
 * `realpathSync`-resolved source: the guard must catch a source-side
 * symlink whose target is nested inside the install root, and the
 * copy-mode payload reads through every symlink so a copy install doesn't
 * leave dangling references back into `node_modules`.
 *
 * No absolute-path symlinks are produced by this function.
 *
 * **Atomicity.** This call is *not* transactional across multi-step
 * installs. The canonical slot is cleared then written, and each
 * `SYMLINK_TARGETS` slot is then cleared and written one at a time. A
 * crash mid-install can leave the canonical slot updated and one or
 * more agent-specific slots stale; re-running `installSkill` (or the
 * `skills sync` subcommand, which iterates over multiple skills) is
 * idempotent and converges back to the intended state. Multi-skill
 * orchestration in {@link createSkillSyncCommand} is fail-fast — the
 * first failed skill aborts the loop without rolling back already-
 * installed siblings, again because re-running converges.
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

  const mode: InstallMode = options.mode ?? "symlink";
  const expectedStamp = skill.frontmatter.metadata?.[OWNERSHIP_METADATA_KEY] ?? null;

  // Copy-mode installs replace an existing real directory in place by
  // matching the on-disk SKILL.md stamp against `expectedStamp`. Without a
  // stamp on the source, the first install creates a real directory but
  // every subsequent install throws "Refusing to replace non-symlink…",
  // because `clearInstallSlot` only rm-rf's when `expectedStamp !== null`
  // and matches. Surface this as an actionable packaging error here rather
  // than letting a second `installSkill` look like a regression.
  if (mode === "copy" && expectedStamp === null) {
    throw new Error(
      `Refusing to install "${skill.frontmatter.name}" in copy mode without an ` +
        `ownership stamp. Add metadata.${OWNERSHIP_METADATA_KEY}="{package}:{cli}" ` +
        `to the source SKILL.md so subsequent installs can replace the copy in place.`,
    );
  }

  const canonicalParent = resolve(cwd, AGENTS_SKILLS_DIR);
  // Two source resolutions, used asymmetrically (see function JSDoc):
  //   - `resolvedSource` — fully `realpathSync`'d, used by the overlap
  //     guard (must catch a source-side symlink whose target is nested
  //     inside the install root) and as the copy-mode payload (so the
  //     copy doesn't leave dangling references back into `node_modules`).
  //     The unconditional `realpathSync` also doubles as the up-front
  //     "source exists" check.
  //   - `symlinkAwareSource` — `realpathSync`'d for every ancestor
  //     symlink EXCEPT a `node_modules/<pkg>` (or
  //     `node_modules/@scope/<pkg>`) hop, which is preserved. Used as
  //     the symlink target. Dereferencing the project-root portion keeps
  //     the relative link target consistent with `resolvedParent` (so
  //     the install survives a copy/remount even when reached via a
  //     symlinked checkout), while preserving the package-manager hop
  //     keeps the install from being broken by a `pnpm update` that
  //     swaps the `.pnpm/<pkg>@<version>_<hash>/...` hash directory.
  const resolvedSource = realpathSync(skill.sourcePath);
  const symlinkAwareSource = resolveSourcePreservingPackageHop(skill.sourcePath);

  // Refuse to install when the source overlaps any destination:
  //   - copy mode: `mkdirSync(dest)` runs before `readdirSync(copyFrom)`,
  //     so a dest inside src would recurse forever (the cyclic-symlink
  //     detector misses this — no symlink is involved).
  //   - symlink mode: `clearInstallSlot` rm-rf's a real directory whose
  //     stamp matches. If that real directory *is* the source, the source
  //     is destroyed before the symlink is even written.
  //
  // Run the guard *before* materialising any destination parent. Otherwise
  // an install that overlaps `cwd` (e.g. a single-skill source rooted at
  // the project directory) still creates `.agents/skills/` (and each
  // `SYMLINK_TARGETS` parent) inside the source tree before throwing.
  // `resolveExistingPrefix` walks up to the deepest existing ancestor and
  // realpath's that, then re-appends the lexical tail — so the comparison
  // still catches /tmp ↔ /private/tmp realpath remaps when the parents
  // don't exist yet. Without including `SYMLINK_TARGETS`, a source living
  // at an agent slot (e.g. `.claude/skills/<name>`) survives the canonical
  // check but gets rm-rf'd later by `populateAgentDirs`'s own
  // `clearInstallSlot` once the source stamp matches — taking the original
  // source data with it. Uses `resolvedSource` so a source-side symlink
  // whose target is nested inside the install root is still caught.
  const canonicalDirPreCheck = join(resolveExistingPrefix(canonicalParent), name);
  const agentSlotsPreCheck = SYMLINK_TARGETS.map((target) =>
    join(resolveExistingPrefix(resolve(cwd, target)), name),
  );
  const overlap = [canonicalDirPreCheck, ...agentSlotsPreCheck].find((dest) =>
    pathsOverlap(dest, resolvedSource),
  );
  if (overlap !== undefined) {
    throw new Error(
      `Refusing to install "${name}": source ${resolvedSource} overlaps install ` +
        `destination ${overlap}. Choose a sourceDir outside .agents/skills/ and any ` +
        `agent-specific slot directory (e.g. .claude/skills/).`,
    );
  }

  // Pre-flight every symlink target *before* any `clearInstallSlot` runs.
  // `symlinkOrCopy` re-checks `isAbsolute(linkTarget)` inline, but by the
  // time it fires the canonical (or an agent-slot) install has already been
  // unlinked. On Windows, `path.relative` returns an absolute path when the
  // endpoints sit on different drive letters; discovering that there would
  // leave the user with no install. Resolve parents through
  // `resolveExistingPrefix` so the check survives parents that don't exist
  // yet (matching the overlap pre-check's prefix style). Uses
  // `symlinkAwareSource` to match the link target written below.
  if (mode === "symlink") {
    const preflightCanonicalParent = resolveExistingPrefix(canonicalParent);
    assertRelativeLinkTarget(
      join(preflightCanonicalParent, name),
      relative(preflightCanonicalParent, symlinkAwareSource),
    );
    for (const target of SYMLINK_TARGETS) {
      const preflightAgentParent = resolveExistingPrefix(resolve(cwd, target));
      assertRelativeLinkTarget(
        join(preflightAgentParent, name),
        join(relative(preflightAgentParent, preflightCanonicalParent), name),
      );
    }
  }

  // Safe to materialise the canonical parent now; `populateAgentDirs`
  // creates each agent-slot parent in its own loop.
  mkdirSync(canonicalParent, { recursive: true });
  // Resolve the parent before computing `linkPath` so the link is written
  // at the canonical path even when an ancestor of `.agents/skills/` is
  // itself a symlink. `linkTarget` is computed from `resolvedParent` and
  // `symlinkAwareSource`: the realpath'd parent matches where the link
  // actually lives on disk, and `symlinkAwareSource` mirrors that
  // realpath style for project-root symlinks while preserving package
  // manager hops (pnpm).
  const resolvedParent = realpathSync(canonicalParent);
  const canonicalDir = join(resolvedParent, name);

  clearInstallSlot(canonicalDir, expectedStamp);
  symlinkOrCopy({
    linkTarget: relative(resolvedParent, symlinkAwareSource),
    linkPath: canonicalDir,
    copyFrom: resolvedSource,
    mode,
  });

  populateAgentDirs(cwd, name, canonicalDir, expectedStamp, mode);
}

/**
 * Refuse to write a symlink whose target was returned absolute. On Windows
 * `path.relative` returns an absolute path when the endpoints live on
 * different drive letters; producing an absolute symlink target would
 * silently break the "relative target" contract and surprise anyone
 * copying the project tree. Used both as the pre-flight in `installSkill`
 * (before any `clearInstallSlot`) and as the in-line guard inside
 * `symlinkOrCopy`.
 */
function assertRelativeLinkTarget(linkPath: string, linkTarget: string): void {
  if (isAbsolute(linkTarget)) {
    throw new Error(
      `Refusing to write an absolute symlink target at ${linkPath} → ${linkTarget}. ` +
        `The skill source and install root appear to live on different ` +
        `filesystem roots (e.g. different Windows drive letters); retry with mode: "copy".`,
    );
  }
}

/**
 * Resolve `sourcePath` so every ancestor symlink (a symlinked checkout,
 * macOS `/tmp` → `/private/tmp`, etc.) gets dereferenced — EXCEPT a
 * `node_modules/<pkg>` or `node_modules/@scope/<pkg>` symlink, which is
 * preserved verbatim from that point onward.
 *
 * Used by `installSkill` to compute the canonical symlink target (see the
 * "Symlink target convention" JSDoc on `installSkill`). The project-root
 * portion of the source must end up in the same realpath style as the
 * install root so a copy/remount keeps both ends in sync; the package
 * manager hop must be preserved so a `pnpm update` that swaps the
 * `.pnpm/<pkg>@<version>_<hash>/...` hashed directory doesn't leave the
 * install dangling.
 *
 * Algorithm: walk root → leaf segment-by-segment. At each segment,
 * `lstatSync` the prefix. If it is a symlink AND its parent looks like a
 * package-manager hop (`node_modules` directly, or an `@scope/` directory
 * inside `node_modules`), return immediately with the remaining segments
 * joined lexically. Otherwise dereference via `realpathSync` (regular
 * directories are kept as-is; ancestor symlinks are followed). If the
 * path doesn't exist past some prefix, return what we have plus the
 * remaining tail lexically — installs against a missing source still
 * throw via the up-front `realpathSync(sourcePath)` call in `installSkill`.
 */
function resolveSourcePreservingPackageHop(sourcePath: string): string {
  const abs = resolve(sourcePath);
  const { root } = parse(abs);
  const parts = abs
    .slice(root.length)
    .split(sep)
    .filter((s) => s !== "");
  let current = root;
  for (const [i, segment] of parts.entries()) {
    const next = join(current, segment);
    let stat;
    try {
      stat = lstatSync(next);
    } catch {
      return join(current, ...parts.slice(i));
    }
    if (stat.isSymbolicLink()) {
      if (isPackageManagerHop(current)) {
        return join(current, ...parts.slice(i));
      }
      current = realpathSync(next);
    } else {
      current = next;
    }
  }
  return current;
}

/**
 * Does `parentDir` look like the directory immediately above a
 * package-manager symlink? Two layouts qualify:
 *
 * - `<...>/node_modules` — a child symlink at this level is a plain
 *   package (`node_modules/<pkg>`).
 * - `<...>/node_modules/@<scope>` — a child symlink at this level is a
 *   scoped package (`node_modules/@scope/<pkg>`).
 *
 * Anything else (a symlinked project checkout, `/tmp`, an arbitrary
 * shortcut elsewhere in the tree) is dereferenced.
 */
function isPackageManagerHop(parentDir: string): boolean {
  if (basename(parentDir) === "node_modules") return true;
  return basename(parentDir).startsWith("@") && basename(dirname(parentDir)) === "node_modules";
}

/**
 * Resolve `p`'s deepest existing ancestor through `realpathSync` and then
 * re-append the lexical tail. Used to compare a not-yet-created destination
 * path against a realpath'd source without materialising the destination —
 * this catches /tmp ↔ /private/tmp style remaps even when the destination
 * parents don't exist yet.
 */
function resolveExistingPrefix(p: string): string {
  let cur = p;
  const tail: string[] = [];
  while (true) {
    try {
      const r = realpathSync(cur);
      return tail.length === 0 ? r : resolve(r, ...tail.reverse());
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return p;
      tail.push(cur.slice(parent.length).replace(/^[/\\]+/, ""));
      cur = parent;
    }
  }
}

/**
 * Uninstall a skill from the project's agent skill directories.
 *
 * Each slot is unlinked only when its ownership can be proven:
 * - Agent-specific symlink slots (`.claude/skills/<name>` etc.) — a live
 *   symlink is unlinked only when it routes to our canonical slot, so a
 *   foreign tool's symlink at the same shared path is left untouched.
 * - The canonical slot (`.agents/skills/<name>`) — a live symlink is
 *   unlinked only when its routed-to SKILL.md carries
 *   `options.expectedOwnership`, so another politty-based CLI's live
 *   install in the same shared namespace is left untouched.
 * - Real directories at any slot are removed only when the directory's
 *   SKILL.md carries `options.expectedOwnership`. Unstamped or foreign
 *   real directories are left alone so legacy/manual installs are not
 *   silently recursively deleted.
 *
 * `skills remove` / `skills sync` always pass `expectedOwnership`. Direct
 * programmatic callers that omit it get the legacy permissive behaviour
 * on symlinks (unconditional unlink) but the conservative behaviour on
 * real directories (no-op). Broken (dangling) canonical symlinks are
 * outside this function's purview — they have no SKILL.md to read, so
 * `cleanupBrokenSlot` handles them with a routing check instead.
 */
export function uninstallSkill(
  name: string,
  cwd: string = process.cwd(),
  options: UninstallSkillOptions = {},
): void {
  assertSafeName(name);
  const expected = options.expectedOwnership ?? null;

  // Agent slots (`.claude/skills/<name>` etc.) live in a shared namespace —
  // restrict symlink unlinking to symlinks that route to our canonical slot
  // so removing one owned canonical skill never deletes another tool's
  // symlink at the same agent path.
  const canonicalSlot = resolve(cwd, AGENTS_SKILLS_DIR, name);
  for (const target of SYMLINK_TARGETS) {
    removeInstalledSlot(resolve(cwd, target, name), expected, {
      restrictSymlinkTo: canonicalSlot,
    });
  }
  removeInstalledSlot(canonicalSlot, expected);
}

/**
 * Does the symlink at `slot` route to `expected`?
 *
 * Used to gate symlink unlinking in shared-namespace agent slots
 * (`.claude/skills/<name>` etc.) so we never silently clobber a symlink
 * another tool installed there.
 *
 * Resolution rules:
 * - Absolute symlink target → compare directly.
 * - Relative target → resolve against the symlink's directory (lexical),
 *   which works even for a dangling symlink we still expect to own.
 * - When both endpoints exist, also match via `realpathSync` so a
 *   logically-equivalent path through a parent symlink still matches.
 */
function symlinkRoutesTo(slot: string, expected: string): boolean {
  let raw: string;
  try {
    raw = readlinkSync(slot);
  } catch {
    return false;
  }
  const resolvedTarget = isAbsolute(raw) ? raw : resolve(dirname(slot), raw);
  if (resolvedTarget === expected) return true;
  try {
    return realpathSync(resolvedTarget) === realpathSync(expected);
  } catch {
    return false;
  }
}

/**
 * Remove a previously-installed slot:
 * - Symlink at an agent-specific slot (`restrictSymlinkTo` provided) →
 *   unlink only when the symlink resolves to that target. A foreign
 *   symlink (another tool, manual install) is left alone so removing one
 *   owned canonical skill never deletes another tool's link.
 * - Symlink at the canonical slot (no `restrictSymlinkTo`) → unlink only
 *   when its routed-to SKILL.md carries `expectedStamp`. `.agents/skills/`
 *   is a namespace shared by every politty-based CLI, so unconditionally
 *   unlinking would let a programmatic `uninstallSkill` caller delete a
 *   foreign CLI's live install. `expectedStamp === null` preserves the
 *   legacy permissive behaviour for callers that opt out of ownership
 *   checks entirely (e.g. teardown helpers).
 * - Real directory whose SKILL.md carries `expectedStamp` → rm -rf. This
 *   handles copy-mode installs that share the same canonical path as the
 *   symlink-mode installs.
 * - Anything else (absent, real dir without matching stamp, real file,
 *   broken symlink with no stamp to read) → no-op; caller can detect
 *   nothing changed by checking after the call.
 *
 * `unlinkSync` (not `rmSync`) is required for symlinks to directories —
 * `rmSync` without `recursive: true` errors "Path is a directory" on a
 * dir-symlink, but passing `recursive: true` would follow the symlink and
 * delete its target contents.
 */
function removeInstalledSlot(
  path: string,
  expectedStamp: string | null,
  options: { restrictSymlinkTo?: string } = {},
): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (err) {
    // Only ENOENT/ENOTDIR mean "no slot to remove" — surface anything else
    // (EACCES/EPERM/IO) so a permission problem doesn't masquerade as an
    // absent install and let `uninstallSkill` report success while the
    // unreadable slot stays in place.
    if (isNodeError(err) && (err.code === "ENOENT" || err.code === "ENOTDIR")) return;
    throw err;
  }
  if (stat.isSymbolicLink()) {
    if (options.restrictSymlinkTo !== undefined) {
      if (symlinkRoutesTo(path, options.restrictSymlinkTo)) {
        unlinkSync(path);
      }
      return;
    }
    // Canonical-slot symlink: verify the routed-to SKILL.md carries
    // `expectedStamp` before unlinking. A `null` expectedStamp restores
    // the legacy permissive behaviour for programmatic callers that opt
    // out of ownership checks entirely.
    if (expectedStamp === null || readStampAt(path) === expectedStamp) {
      unlinkSync(path);
    }
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
 * - Symlink (live or broken) → unlink. In a shared-namespace slot
 *   (`restrictSymlinkTo` provided), only when the symlink resolves to that
 *   target; a foreign symlink at the slot throws instead of being silently
 *   replaced.
 * - Real directory whose SKILL.md carries `expectedStamp` → rm -rf. This
 *   is how a copy-mode install gets replaced in place by another install
 *   (symlink or copy); the ownership check guarantees we are only ever
 *   removing data we previously produced.
 * - Real file or foreign real directory → throw. The ownership guards in
 *   `addSkill` / `removeOwnedSkill` usually prevent this from being
 *   reachable, but a programmatic caller or a hand-made legacy install
 *   surfaces as an actionable error here rather than silent data loss.
 */
function clearInstallSlot(
  path: string,
  expectedStamp: string | null,
  options: { restrictSymlinkTo?: string } = {},
): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (err) {
    // Symmetry with `removeInstalledSlot`: only "no entry" means "nothing to
    // clear". Other errors (EACCES/EPERM/IO) would otherwise look like an
    // empty slot and the subsequent symlink/copy would either silently
    // overwrite via a non-atomic race or fail with a less actionable error.
    if (isNodeError(err) && (err.code === "ENOENT" || err.code === "ENOTDIR")) return;
    throw err;
  }
  if (stat.isSymbolicLink()) {
    if (
      options.restrictSymlinkTo === undefined ||
      symlinkRoutesTo(path, options.restrictSymlinkTo)
    ) {
      unlinkSync(path);
      return;
    }
    throw new Error(
      `Refusing to replace symlink at ${path}: it does not route to this ` +
        `CLI's canonical slot (${options.restrictSymlinkTo}). ` +
        `Remove or migrate the foreign symlink before retrying.`,
    );
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
 * Create `linkPath` as a symlink to `linkTarget` (symlink mode) or
 * recursively copy `copyFrom` into `linkPath` (copy mode).
 *
 * In symlink mode, a `symlinkSync` failure is re-thrown with guidance to
 * retry with `mode: "copy"`. Windows without Developer Mode is the
 * canonical case — the underlying EPERM doesn't hint at the fix on its
 * own.
 */
function symlinkOrCopy(args: {
  linkTarget: string;
  linkPath: string;
  copyFrom: string;
  mode: InstallMode;
}): void {
  const { linkTarget, linkPath, copyFrom, mode } = args;
  if (mode === "copy") {
    copyDirRecursive(copyFrom, linkPath);
    return;
  }
  // `path.relative` returns an absolute path on Windows when the two
  // endpoints live on different drive letters. Producing an absolute
  // symlink target would silently break the "relative target" contract —
  // the install becomes non-portable across volume mounts and surprises
  // anyone copying the project tree. Force the caller toward `mode: "copy"`
  // instead of writing the absolute target. Defense in depth: `installSkill`
  // pre-flights every link target before any `clearInstallSlot` so a
  // discovery here means the pre-flight got bypassed (e.g. a programmatic
  // caller that builds its own argument set).
  assertRelativeLinkTarget(linkPath, linkTarget);
  try {
    symlinkSync(linkTarget, linkPath, "dir");
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to symlink ${linkPath} → ${linkTarget}: ${cause}. ` +
        `If this filesystem does not support symlinks (e.g. Windows without ` +
        `Developer Mode), retry with mode: "copy".`,
      { cause: err },
    );
  }
}

/**
 * Recursively copy `src` to `dest` following symlinks (`statSync`, not
 * `lstatSync`). Symlinks in the source are materialised as copies of
 * their target content so the install does not leave dangling references
 * back into `node_modules`. Non-regular files (sockets, devices) are
 * ignored.
 *
 * `activeRealPaths` tracks the realpath of every directory currently on
 * the recursion stack so a directory symlink pointing at an ancestor
 * (e.g. `foo/bar -> ../..`) fails fast instead of recursing until the
 * stack overflows or the disk fills.
 */
function copyDirRecursive(
  src: string,
  dest: string,
  activeRealPaths: Set<string> = new Set(),
): void {
  const stat = statSync(src);
  if (stat.isDirectory()) {
    const realSrc = realpathSync(src);
    if (activeRealPaths.has(realSrc)) {
      throw new Error(
        `Refusing to recursively copy cyclic directory symlink at ${src} ` +
          `(resolves to ${realSrc}, already on the copy stack).`,
      );
    }
    activeRealPaths.add(realSrc);
    try {
      mkdirSync(dest, { recursive: true });
      for (const entry of readdirSync(src)) {
        copyDirRecursive(join(src, entry), join(dest, entry), activeRealPaths);
      }
    } finally {
      activeRealPaths.delete(realSrc);
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
 * once. When `mode` is `"copy"` the slot is a recursive copy of
 * `canonicalDir` instead.
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

    // realpath the PARENT directories only. Resolving `canonicalDir` itself
    // would dereference it to the source path (in symlink mode), baking the
    // source location into every agent link; the agent link should route
    // through the canonical slot instead so a single `skills sync`
    // replaces both hops at once. The link is created at the realpath'd
    // parent so `linkPath` and `linkTarget` share the same prefix style.
    const resolvedTargetParent = realpathSync(targetParent);
    const targetDir = join(resolvedTargetParent, name);
    // Agent slot is a shared namespace; only unlink an existing symlink if
    // it routes to our canonical slot. The canonical slot lives at the
    // realpath-resolved parent join'd with `name`, matching what we'll
    // write below.
    clearInstallSlot(targetDir, expectedStamp, { restrictSymlinkTo: canonicalDir });

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

/**
 * Do `a` and `b` refer to the same directory, or is one nested inside the
 * other? Used to refuse copy-mode installs where the source and destination
 * would recurse into each other. Inputs are expected to be `realpathSync`'d
 * absolute paths so trailing separators and symlink hops don't desynchronise
 * the comparison.
 *
 * Containment is boundary-aware: only `..` or `..<sep>...` counts as escaping
 * `outer`. A relative path like `..backup` is a same-level sibling (one
 * segment whose name happens to start with two dots), so it must NOT be
 * treated as escape. The previous `startsWith("..")` check misclassified such
 * names as outside, missing real overlaps with siblings whose name begins
 * with `..`.
 */
function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const isContainedIn = (inner: string, outer: string): boolean => {
    const rel = relative(outer, inner);
    if (rel === "" || rel === ".") return true;
    if (isAbsolute(rel)) return false;
    return rel !== ".." && !rel.startsWith(`..${sep}`);
  };
  return isContainedIn(a, b) || isContainedIn(b, a);
}
