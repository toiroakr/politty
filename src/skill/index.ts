/**
 * Skill management module for coding agent CLIs.
 *
 * Provides source-directory scanning and file-based installation of
 * SKILL.md-based agent skills, validated against the Agent Skills
 * specification (https://agentskills.io/specification).
 *
 * Provenance of politty-managed installs is recorded under
 * `metadata["politty-cli"]` as `"{packageName}:{cliName}"`.
 *
 * @packageDocumentation
 */

// Public API re-exports
export { parseFrontmatter, parseSkillMd, skillFrontmatterSchema } from "./frontmatter.js";
export {
  installSkill,
  OWNERSHIP_METADATA_KEY,
  readInstalledOwnership,
  uninstallSkill,
} from "./installer.js";
export { scanSourceDir } from "./scanner.js";
export { SCAN_ERROR_REASONS } from "./types.js";
export type {
  DiscoveredSkill,
  ScanError,
  ScanErrorReason,
  ScanResult,
  SkillFrontmatter,
} from "./types.js";
