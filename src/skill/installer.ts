import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
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
 * Key used to stamp provenance on politty-installed skills. Written into
 * `metadata["politty-cli"]` as `"{packageName}:{cliName}"` so `skills
 * remove` can tell apart skills this CLI installed from skills another
 * tool manages.
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
 * The skill is assembled in a temporary sibling directory and `rename`d
 * into place, which prevents partially-copied content from ever being
 * observed. When replacing an existing installation, the canonical
 * directory is removed before the rename, so the skill path may be
 * briefly absent during the swap — this is not a full atomic replace.
 * The ownership stamp `metadata["politty-cli"]` is rewritten at install
 * time based on the caller-supplied `ownership` value.
 *
 * @param ownership - `"{packageName}:{cliName}"` — required. Written to
 *   `metadata["politty-cli"]` of the installed SKILL.md.
 */
export function installSkill(
  skill: DiscoveredSkill,
  ownership: string,
  cwd: string = process.cwd(),
): void {
  const name = skill.frontmatter.name;
  assertSafeName(name);

  const canonicalParent = resolve(cwd, AGENTS_SKILLS_DIR);
  mkdirSync(canonicalParent, { recursive: true });

  // Stage into a temp dir on the same filesystem, then rename() atomically.
  // This avoids observable partial state if the process crashes mid-copy.
  const stagingDir = mkdtempSync(join(canonicalParent, `.install-${name}-`));
  try {
    cpSync(skill.sourcePath, stagingDir, {
      recursive: true,
      dereference: false,
      // Skip symlinks from the source tree so a crafted npm package cannot
      // plant a link that escapes the project root (e.g. $HOME or /etc).
      filter: (src) => !isSymlink(src),
    });

    // If the source SKILL.md was itself a symlink, the filter above dropped
    // it and the staged skill is now incomplete. Refuse rather than install
    // a skill dir with no SKILL.md.
    if (!existsSync(join(stagingDir, "SKILL.md"))) {
      throw new Error(
        `Skill "${name}" has no SKILL.md after staging (was it a symlink in the source tree?)`,
      );
    }

    stampOwnership(stagingDir, ownership);

    const canonicalDir = join(canonicalParent, name);
    // Clear any previous install (normal dir, symlink, or broken link)
    // before rename so rename() has a clear target.
    if (existsSync(canonicalDir) || isSymlink(canonicalDir)) {
      rmSync(canonicalDir, { recursive: true, force: true });
    }
    renameSync(stagingDir, canonicalDir);

    populateAgentDirs(cwd, name, canonicalDir);
  } catch (error) {
    // Clean up staging dir on failure so repeated installs don't leak.
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Uninstall a skill from the project's agent skill directories.
 *
 * Removes symlinks from agent directories, then removes the canonical copy.
 */
export function uninstallSkill(name: string, cwd: string = process.cwd()): void {
  assertSafeName(name);

  for (const target of SYMLINK_TARGETS) {
    const targetDir = resolve(cwd, target, name);
    if (existsSync(targetDir) || isSymlink(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
  }

  const canonicalDir = resolve(cwd, AGENTS_SKILLS_DIR, name);
  if (existsSync(canonicalDir) || isSymlink(canonicalDir)) {
    rmSync(canonicalDir, { recursive: true, force: true });
  }
}

/**
 * Read the ownership stamp off an installed skill's SKILL.md, if any.
 *
 * @returns `metadata["politty-cli"]` as `"{packageName}:{cliName}"`, or
 *   `null` if the skill is not installed or the stamp is absent/malformed.
 */
export function readInstalledOwnership(name: string, cwd: string = process.cwd()): string | null {
  assertSafeName(name);
  const path = resolve(cwd, AGENTS_SKILLS_DIR, name, "SKILL.md");
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (err) {
    // Treat "file absent" as "no ownership"; surface anything else (e.g.
    // EACCES) so a permission bug doesn't look like an unstamped skill and
    // get silently clobbered by `remove`/`sync`.
    if (isNodeError(err) && err.code === "ENOENT") return null;
    throw err;
  }
  const { data } = parseFrontmatter(content);
  const metadata = (data as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[OWNERSHIP_METADATA_KEY];
  return typeof value === "string" ? value : null;
}

/**
 * Rewrite `metadata["politty-cli"]` in the staged SKILL.md so the on-disk
 * copy always reflects the install context, even if the source frontmatter
 * carries a stale or missing stamp.
 */
function stampOwnership(stagingDir: string, ownership: string): void {
  const skillMdPath = join(stagingDir, "SKILL.md");
  // Caller (installSkill) already asserted SKILL.md exists after staging.
  const content = readFileSync(skillMdPath, "utf-8");
  const match = content.match(/^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/);
  if (!match) {
    // Scanner only accepts skills whose frontmatter parses, so an absent
    // fence here means the source tree was tampered with between scan and
    // install. Fail loud rather than ship an unstamped skill.
    throw new Error(
      `Skill SKILL.md at ${skillMdPath} has no YAML frontmatter; refusing to install without an ownership stamp`,
    );
  }

  const [, openFence, yamlBlock, closeFence] = match as unknown as [string, string, string, string];
  const body = content.slice(match[0].length);
  const rewritten = upsertMetadataKey(yamlBlock, OWNERSHIP_METADATA_KEY, ownership);
  writeFileSync(skillMdPath, `${openFence}${rewritten}${closeFence}${body}`, "utf-8");
}

/**
 * Upsert a single `metadata.<key>: <value>` pair in a YAML frontmatter
 * block.
 *
 * Lines outside the metadata section are left verbatim in block-style
 * frontmatter. Line endings are normalized to LF on output — callers write
 * the stamped file fresh, so the exact original newline style is not
 * preserved.
 *
 * Flow-style metadata (`metadata: {}` or `metadata: { foo: bar }`) is
 * rewritten in block form with the upserted key. Other top-level keys that
 * use flow style are untouched; a full YAML round-trip would reformat
 * unrelated fields and is deliberately avoided.
 */
function upsertMetadataKey(yaml: string, key: string, value: string): string {
  const lines = yaml.split(/\r?\n/);
  const quotedValue = JSON.stringify(value); // safe YAML scalar via double-quoting

  const metaIdx = lines.findIndex((line) => /^metadata[ \t]*:/.test(line));
  if (metaIdx === -1) {
    const suffix = lines.length > 0 && lines[lines.length - 1] === "" ? "" : "\n";
    return `${yaml}${suffix}metadata:\n  ${key}: ${quotedValue}`;
  }

  // Flow-style inline metadata: reparse the value, merge our key, and
  // rewrite the whole section in block form. A line-based splice would
  // produce invalid YAML here. We only take this branch when the value
  // clearly starts a flow map (`{ ... }`) — trailing comments or other
  // scalar decorations (e.g. `metadata: # note`) must fall through to the
  // block-style path so we don't rewrite a legal block into an empty map.
  const inlineMatch = lines[metaIdx]!.match(/^metadata[ \t]*:[ \t]*(\{.*)$/);
  if (inlineMatch) {
    const existing = parseInlineMap(inlineMatch[1]!);
    existing[key] = value;
    const rebuilt = ["metadata:"];
    for (const [k, v] of Object.entries(existing)) {
      rebuilt.push(`  ${k}: ${JSON.stringify(v)}`);
    }
    return [...lines.slice(0, metaIdx), ...rebuilt, ...lines.slice(metaIdx + 1)].join("\n");
  }

  // Block-style metadata: find the extent of indented child lines.
  let end = metaIdx + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    if (line === "" || /^[ \t]/.test(line)) {
      end += 1;
    } else {
      break;
    }
  }

  // Match existing child indent so writes into a 4-space (or tab-indented)
  // metadata block don't break the mapping. Fall back to two spaces if the
  // block has no children yet.
  const firstChildIndent = findFirstChildIndent(lines, metaIdx + 1, end);
  const indent = firstChildIndent ?? "  ";

  const keyPattern = new RegExp(`^[ \\t]+${escapeRegex(key)}[ \\t]*:`);
  for (let i = metaIdx + 1; i < end; i++) {
    if (keyPattern.test(lines[i]!)) {
      lines[i] = `${indent}${key}: ${quotedValue}`;
      return lines.join("\n");
    }
  }
  lines.splice(end, 0, `${indent}${key}: ${quotedValue}`);
  return lines.join("\n");
}

function findFirstChildIndent(lines: string[], start: number, end: number): string | null {
  for (let i = start; i < end; i++) {
    const m = lines[i]!.match(/^([ \t]+)\S/);
    if (m) return m[1]!;
  }
  return null;
}

function parseInlineMap(source: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch {
    return {};
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    // Spec restricts metadata values to strings. If source frontmatter
    // carries a non-string value, refuse rather than silently drop it — the
    // scanner should have rejected it, but be defensive.
    if (typeof v !== "string") {
      throw new Error(
        `metadata["${k}"] is not a string (got ${typeof v}); SKILL.md metadata values must be strings`,
      );
    }
    out[k] = v;
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create symlinks (or copy fallback) from each agent-specific directory
 * into the canonical skill directory.
 *
 * When re-pointing an existing agent-specific link, the old entry is
 * removed before the new `symlink`/`cpSync` runs, so the agent path is
 * briefly absent during the swap. This window is per agent-directory and
 * independent of the canonical `rename`.
 *
 * The `cpSync` fallback (Windows without Developer Mode, or other
 * `symlink` failures) produces a real copy rather than a link. In that
 * configuration subsequent `skills sync` runs must re-copy the canonical
 * content into the agent directory — plain edits to `.agents/skills/`
 * will not propagate by themselves.
 */
function populateAgentDirs(cwd: string, name: string, canonicalDir: string): void {
  for (const target of SYMLINK_TARGETS) {
    const targetParent = resolve(cwd, target);
    mkdirSync(targetParent, { recursive: true });

    const targetDir = join(targetParent, name);
    if (existsSync(targetDir) || isSymlink(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }

    try {
      // Resolve both paths through symlinks so the relative link stays
      // correct when either the agent directory or the project path itself
      // includes symlink components (e.g. `.claude/skills` is a link, or
      // the CLI is invoked from a symlinked checkout).
      const resolvedParent = realpathSync(targetParent);
      const resolvedCanonicalDir = realpathSync(canonicalDir);
      const linkTarget = relative(resolvedParent, resolvedCanonicalDir);
      symlinkSync(linkTarget, targetDir, "dir");
    } catch {
      // Symlink failed (e.g. Windows without dev mode) — fall back to copy.
      cpSync(canonicalDir, targetDir, { recursive: true });
    }
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
