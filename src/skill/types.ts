import type { z } from "zod";
import type { skillFrontmatterSchema } from "./frontmatter.js";

/**
 * SKILL.md frontmatter metadata.
 *
 * Follows vercel-labs/skills SKILL.md format with an additional `package` field
 * for tracking provenance (which npm package a skill originated from).
 */
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

/**
 * A skill discovered from a source directory (npm package).
 */
export interface DiscoveredSkill {
  /** Parsed frontmatter metadata */
  frontmatter: SkillFrontmatter;
  /** Absolute path to the directory containing SKILL.md */
  sourcePath: string;
  /** Raw SKILL.md content (frontmatter + body) */
  rawContent: string;
}

/**
 * A skill installed in the project.
 */
export interface InstalledSkill {
  /** Parsed frontmatter metadata */
  frontmatter: SkillFrontmatter;
  /** Absolute path to the installed skill directory */
  installedPath: string;
}

/**
 * Options for `withSkillCommand`.
 */
export interface SkillCommandOptions {
  /**
   * Source directories containing SKILL.md files.
   * Each directory's subdirectories with SKILL.md are treated as skills.
   *
   * @example
   * ```typescript
   * sourceDirs: [
   *   require.resolve("@my-agent/skills/skills"),
   *   require.resolve("@my-agent/community/skills"),
   * ]
   * ```
   */
  sourceDirs: string[];
}
