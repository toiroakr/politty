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
 * Symlinked subdirectories are skipped: a dependency could otherwise point
 * the scan outside its own tree.
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

    // Single-skill source: the dir itself has a SKILL.md.
    if (existsSync(join(sourceDir, SKILL_MD))) {
      pushResult(tryParseSkillDir(sourceDir, { enforceParentMatch: false }), skills, errors);
      return { skills, errors };
    }

    // Otherwise, scan immediate subdirectories.
    const entries = readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = join(sourceDir, entry.name);

      // Skip symlinks so a dependency cannot plant a link escaping its tree.
      if (isSymlink(skillDir)) continue;
      if (!existsSync(join(skillDir, SKILL_MD))) continue;

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

  // Require SKILL.md to be a regular file. A crafted npm package could
  // otherwise make it a symlink to an attacker-chosen path (e.g. an
  // environment file) and trick the scanner into parsing unexpected
  // content as frontmatter.
  try {
    if (!lstatSync(skillMdPath).isFile()) {
      return {
        path: dir,
        reason: "read-failed",
        message: `${skillMdPath} is not a regular file (symlinks are rejected)`,
      };
    }
  } catch (error) {
    return {
      path: dir,
      reason: "read-failed",
      message: `Failed to stat ${skillMdPath}: ${errorMessage(error)}`,
    };
  }

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

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
