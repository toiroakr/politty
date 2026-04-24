import type { z } from "zod";
import type { skillFrontmatterSchema } from "./frontmatter.js";

/**
 * SKILL.md frontmatter metadata, validated against the Agent Skills
 * specification (https://agentskills.io/specification).
 *
 * Provenance for politty-managed installs is recorded under
 * `metadata["politty-cli"]` as `"{packageName}:{cliName}"`.
 */
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

/**
 * A skill discovered from a source directory (npm package).
 */
export interface DiscoveredSkill {
  /** Parsed frontmatter metadata */
  frontmatter: SkillFrontmatter;
  /** Path to the directory containing SKILL.md */
  sourcePath: string;
  /** Raw SKILL.md content (frontmatter + body) */
  rawContent: string;
}

/**
 * All kinds of scan failure, as a runtime tuple so callers can exhaustively
 * iterate (e.g. for message tables). Derived {@link ScanErrorReason} stays
 * the single source of truth for the type-level enum.
 */
export const SCAN_ERROR_REASONS = [
  "parse-failed",
  "name-mismatch",
  "read-failed",
  "missing-source",
] as const;

/** Kind of problem encountered by {@link scanSourceDir}. */
export type ScanErrorReason = (typeof SCAN_ERROR_REASONS)[number];

/**
 * A non-fatal problem encountered while scanning a source directory.
 *
 * Scan errors (invalid frontmatter, name/parent-dir mismatch, unreadable
 * files) are collected rather than thrown so that a single malformed skill
 * does not hide the rest from CLI commands.
 */
export interface ScanError {
  /** Directory that produced the error. */
  path: string;
  /** Kind of problem encountered. */
  reason: ScanErrorReason;
  /** Human-readable detail, suitable for logging. */
  message: string;
}

/**
 * Result of scanning a source directory for SKILL.md files.
 */
export interface ScanResult {
  /** Valid, spec-compliant skills. */
  skills: DiscoveredSkill[];
  /** Directories that looked like skills but failed validation. */
  errors: ScanError[];
}

/**
 * Options for `withSkillCommand`.
 */
export interface SkillCommandOptions {
  /**
   * Source directory containing SKILL.md files.
   *
   * Each subdirectory whose name matches its `SKILL.md` frontmatter `name`
   * is treated as a skill. Symlinks within the source tree are followed.
   *
   * @example
   * ```typescript
   * // Resolves to ../skills relative to the current file.
   * // Works from both src/ and dist/ if at the same depth.
   * const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), "../skills");
   * ```
   */
  sourceDir: string;

  /**
   * npm package name that owns this CLI's bundled skills.
   *
   * Each source `SKILL.md` must pre-declare
   * `metadata["politty-cli"]: "{package}:{cliName}"`. The `skills add` and
   * `skills sync` subcommands verify this stamp before installing — two
   * tools managing skills in the same project cannot accidentally clobber
   * each other. `installSkill` itself performs only the symlink operation;
   * programmatic callers that bypass `withSkillCommand` are responsible for
   * validating ownership up front.
   */
  package: string;
}
