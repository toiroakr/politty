import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
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
    if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
      errors.push({
        path: sourceDir,
        reason: "missing-source",
        message: `Source directory does not exist or is not a directory: ${sourceDir}`,
      });
      return { skills, errors };
    }

    // Single-skill source: the dir itself has a SKILL.md. `skillMdPresent`
    // uses `lstatSync` so a broken SKILL.md symlink is still recognised as
    // present and surfaces as a `read-failed` scan error, not silently
    // treated as "no SKILL.md here" (which would flip a single-skill source
    // into an empty bundle).
    if (skillMdPresent(join(sourceDir, SKILL_MD))) {
      pushResult(tryParseSkillDir(sourceDir, { enforceParentMatch: false }), skills, errors);
      return { skills, errors };
    }

    // Otherwise, scan immediate subdirectories. `statSync` follows
    // symlinks, so a symlinked skill dir is still recognised as a
    // directory (unlike `isDirectory` on the raw Dirent).
    const entries = readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const skillDir = join(sourceDir, entry.name);
      try {
        if (!statSync(skillDir).isDirectory()) continue;
      } catch {
        continue;
      }
      if (!skillMdPresent(join(skillDir, SKILL_MD))) continue;

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

  const { data } = parseFrontmatter(content);
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

/**
 * Presence check that treats a broken symlink as "present" so downstream
 * parsing can report it as a `read-failed` scan error instead of silently
 * skipping the candidate. `existsSync` follows symlinks and returns false
 * for broken ones, which is the wrong default for scan reporting.
 */
function skillMdPresent(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
