/**
 * Skill management module for coding agent CLIs.
 *
 * Provides source-directory scanning for SKILL.md-based agent skills,
 * validated against the Agent Skills specification
 * (https://agentskills.io/specification).
 *
 * @packageDocumentation
 */

// Public API re-exports
export { parseFrontmatter, parseSkillMd, skillFrontmatterSchema } from "./frontmatter.js";
export { scanSourceDir } from "./scanner.js";
export { SCAN_ERROR_REASONS } from "./types.js";
export type {
  DiscoveredSkill,
  ScanError,
  ScanErrorReason,
  ScanResult,
  SkillFrontmatter,
} from "./types.js";
