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
 * How an install materializes skill files under `.agents/skills/<name>`
 * and each `SYMLINK_TARGETS` entry.
 *
 * - `"auto"` (default): attempt a symlink; if `symlinkSync` fails (e.g.
 *   Windows without Developer Mode, filesystems that do not support
 *   symlinks), fall back to a recursive copy. Source updates propagate
 *   live only for the paths that ended up as symlinks.
 * - `"symlink"`: symlink only. Throws if `symlinkSync` fails — useful when
 *   the CLI author requires live-updating installs and wants packaging
 *   failures to surface, not silently become copies.
 * - `"copy"`: recursive copy only. Source updates require re-running
 *   `skills sync`. Works on any filesystem, trades liveness for portability.
 */
export type InstallMode = "auto" | "symlink" | "copy";

/** Options for {@link installSkill}. */
export interface InstallSkillOptions {
  /** Install materialization strategy. Default: `"auto"`. */
  mode?: InstallMode;
}

/** Options for {@link uninstallSkill}. */
export interface UninstallSkillOptions {
  /**
   * If set, `uninstallSkill` also removes a real directory at the install
   * path when its SKILL.md's `metadata["politty-cli"]` matches this stamp
   * (a copy-mode install this CLI owns). Without this option, only
   * symlinks are removed — real directories are assumed to be legacy or
   * manual installs and left untouched.
   */
  expectedOwnership?: string;
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

  /**
   * Default install mode for the `skills add` and `skills sync` commands.
   * Defaults to `"auto"` — try symlink, fall back to copy on filesystems
   * that do not support symlinks (e.g. Windows without Developer Mode).
   * Set to `"symlink"` to require live-updating installs, or `"copy"` to
   * always copy. See {@link InstallMode}.
   */
  mode?: InstallMode;
}
