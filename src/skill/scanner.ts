import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter, skillFrontmatterSchema } from "./frontmatter.js";
import type { DiscoveredSkill, ScanError, ScanResult } from "./types.js";

const SKILL_MD = "SKILL.md";

/**
 * Scan a source directory for SKILL.md files.
 *
 * Each immediate subdirectory is a candidate skill; its `SKILL.md` is
 * parsed and validated against the Agent Skills specification, and the
 * frontmatter `name` must match the subdirectory name (spec requirement).
 *
 * If `sourceDir` itself contains a `SKILL.md`, it is treated as a
 * single-skill source. The parent-directory-name match is not enforced in
 * that case because the caller chose an arbitrary path.
 *
 * Symlinks within the source tree are followed (symlinked skill dirs and
 * symlinked SKILL.md files are both accepted). npm packages already
 * execute arbitrary JS on install, so additional symlink-based isolation
 * here would not raise the trust boundary in any realistic threat model.
 *
 * @example
 * ```
 * sourceDir: "node_modules/@my-agent/skills/skills"
 *
 * node_modules/@my-agent/skills/skills/
 * ├── commit/
 * │   └── SKILL.md
 * └── review-pr/
 *     └── SKILL.md
 * ```
 */
export function scanSourceDir(sourceDir: string): ScanResult {
  const skills: DiscoveredSkill[] = [];
  const errors: ScanError[] = [];

  try {
    // Surface a missing or non-directory sourceDir as an explicit error so
    // callers (notably `sync`, which deletes orphans) can refuse to act on
    // what is almost certainly a misconfiguration rather than interpret
    // "no skills found" as a signal to remove every installed skill.
    // Use a try/catch around `statSync` (instead of `existsSync` + `statSync`)
    // so permission/IO errors (EACCES/EPERM) surface as `read-failed`
    // rather than being silently misclassified as `missing-source`.
    let sourceStat;
    try {
      sourceStat = statSync(sourceDir);
    } catch (error) {
      if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
        errors.push({
          path: sourceDir,
          reason: "missing-source",
          message: `Source directory does not exist: ${sourceDir}`,
        });
      } else {
        errors.push({
          path: sourceDir,
          reason: "read-failed",
          message: `Failed to stat source directory ${sourceDir}: ${errorMessage(error)}`,
        });
      }
      return { skills, errors };
    }
    if (!sourceStat.isDirectory()) {
      errors.push({
        path: sourceDir,
        reason: "missing-source",
        message: `Source path is not a directory: ${sourceDir}`,
      });
      return { skills, errors };
    }

    // Single-skill source: the dir itself has a SKILL.md. `skillMdPresent`
    // uses `lstatSync` so a broken SKILL.md symlink is still recognised as
    // present and surfaces as a `read-failed` scan error, not silently
    // treated as "no SKILL.md here" (which would flip a single-skill source
    // into an empty bundle).
    const rootSkillMdPath = join(sourceDir, SKILL_MD);
    const rootCheck = skillMdPresent(rootSkillMdPath);
    if (rootCheck.kind === "error") {
      errors.push({
        path: sourceDir,
        reason: "read-failed",
        message: `Failed to check ${rootSkillMdPath}: ${rootCheck.message}`,
      });
      return { skills, errors };
    }
    if (rootCheck.kind === "present") {
      pushResult(tryParseSkillDir(sourceDir, { enforceParentMatch: false }), skills, errors);
      return { skills, errors };
    }

    // Otherwise, scan immediate subdirectories. `statSync` follows
    // symlinks, so a symlinked skill dir is still recognised as a
    // directory (unlike `isDirectory` on the raw Dirent).
    const entries = readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const skillDir = join(sourceDir, entry.name);
      let isDir: boolean;
      try {
        isDir = statSync(skillDir).isDirectory();
      } catch (error) {
        // Permission/IO errors on a single entry must not hide the rest of
        // the source dir. ENOENT for a non-symlink entry is a racing
        // remove between readdir and stat — skip silently. ENOENT for a
        // symlink entry is a dangling link (a real misconfiguration, e.g.
        // a stale monorepo path); surface it as `read-failed` so the
        // entry doesn't disappear from the scan without a trace.
        if (isNodeError(error) && error.code === "ENOENT" && !entry.isSymbolicLink()) {
          continue;
        }
        errors.push({
          path: skillDir,
          reason: "read-failed",
          message: entry.isSymbolicLink()
            ? `Dangling symlink at ${skillDir}: ${errorMessage(error)}`
            : `Failed to stat ${skillDir}: ${errorMessage(error)}`,
        });
        continue;
      }
      if (!isDir) continue;
      const skillMdPath = join(skillDir, SKILL_MD);
      const childCheck = skillMdPresent(skillMdPath);
      if (childCheck.kind === "error") {
        errors.push({
          path: skillDir,
          reason: "read-failed",
          message: `Failed to check ${skillMdPath}: ${childCheck.message}`,
        });
        continue;
      }
      if (childCheck.kind === "absent") continue;

      pushResult(tryParseSkillDir(skillDir, { enforceParentMatch: true }), skills, errors);
    }
  } catch (error) {
    errors.push({
      path: sourceDir,
      reason: "read-failed",
      message: `Failed to scan ${sourceDir}: ${errorMessage(error)}`,
    });
  }

  skills.sort((a, b) =>
    a.frontmatter.name < b.frontmatter.name ? -1 : a.frontmatter.name > b.frontmatter.name ? 1 : 0,
  );
  return { skills, errors };
}

function tryParseSkillDir(
  dir: string,
  opts: { enforceParentMatch: boolean },
): DiscoveredSkill | ScanError {
  const skillMdPath = join(dir, SKILL_MD);

  let content: string;
  try {
    content = readFileSync(skillMdPath, "utf-8");
  } catch (error) {
    return {
      path: dir,
      reason: "read-failed",
      message: `Failed to read ${skillMdPath}: ${errorMessage(error)}`,
    };
  }

  const { data, parseError } = parseFrontmatter(content);
  if (parseError !== undefined) {
    return {
      path: dir,
      reason: "parse-failed",
      message: `Invalid SKILL.md frontmatter in ${dir}: YAML parse error: ${parseError}`,
    };
  }
  const result = skillFrontmatterSchema.safeParse(data);
  if (!result.success) {
    return {
      path: dir,
      reason: "parse-failed",
      message: `Invalid SKILL.md frontmatter in ${dir}: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    };
  }

  if (opts.enforceParentMatch) {
    const parent = basename(dir);
    if (parent !== result.data.name) {
      return {
        path: dir,
        reason: "name-mismatch",
        message: `Skill name "${result.data.name}" does not match directory "${parent}"`,
      };
    }
  }

  return {
    frontmatter: result.data,
    sourcePath: dir,
    rawContent: content,
  };
}

function pushResult(
  value: DiscoveredSkill | ScanError,
  skills: DiscoveredSkill[],
  errors: ScanError[],
): void {
  if ("frontmatter" in value) {
    skills.push(value);
  } else {
    errors.push(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

/**
 * Tri-state presence check for `SKILL.md`. A broken symlink resolves to
 * `present` so downstream parsing can still report it as a `read-failed`
 * scan error rather than silently skipping the candidate. Permission /
 * IO errors resolve to `error` so the caller can surface them as
 * `read-failed` — swallowing them as `absent` would let an unreadable
 * source directory disappear from the scan without a trace.
 * `existsSync` follows symlinks and returns false for broken ones, which
 * is the wrong default for scan reporting.
 */
type PresenceCheck = { kind: "present" } | { kind: "absent" } | { kind: "error"; message: string };

function skillMdPresent(path: string): PresenceCheck {
  try {
    lstatSync(path);
    return { kind: "present" };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { kind: "absent" };
    return { kind: "error", message: errorMessage(error) };
  }
}
