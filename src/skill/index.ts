/**
 * Skill management module for coding agent CLIs.
 *
 * Provides source-directory scanning and file-based installation of
 * SKILL.md-based agent skills, validated against the Agent Skills
 * specification (https://agentskills.io/specification).
 *
 * Provenance of politty-managed installs is recorded under
 * `metadata["politty-cli"]` as `"{packageName}:{cliName}"`, so
 * `skills remove` can safely refuse to delete skills that belong to
 * another tool.
 *
 * @example
 * ```typescript
 * import { dirname, resolve } from "node:path";
 * import { fileURLToPath } from "node:url";
 * import { defineCommand, runMain } from "politty";
 * import { withSkillCommand } from "politty/skill";
 *
 * const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), "../skills");
 *
 * const cli = withSkillCommand(
 *   defineCommand({
 *     name: "my-agent",
 *     description: "My coding agent CLI",
 *     subCommands: {
 *       run: runCommand,
 *     },
 *   }),
 *   { sourceDir, package: "@my-agent/skills" },
 * );
 *
 * runMain(cli);
 * ```
 *
 * SKILL.md format (spec-compliant):
 * ```markdown
 * ---
 * name: commit
 * description: Git commit message generation
 * license: MIT
 * metadata:
 *   politty-cli: "@my-agent/skills:my-agent"
 * ---
 * # Instructions for the agent...
 * ```
 *
 * @packageDocumentation
 */

import { defineCommand } from "../core/command.js";
import type { AnyCommand } from "../types.js";
import {
  createSkillAddCommand,
  createSkillListCommand,
  createSkillRemoveCommand,
  createSkillSyncCommand,
} from "./commands.js";
import type { SkillCommandOptions } from "./types.js";

// Public API re-exports
export { parseFrontmatter, parseSkillMd, skillFrontmatterSchema } from "./frontmatter.js";
export {
  hasInstalledSkill,
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
  SkillCommandOptions,
  SkillFrontmatter,
} from "./types.js";

/**
 * Wrap a command with a `skills` subcommand for managing SKILL.md-based skills.
 *
 * Adds `skills sync`, `skills add`, `skills remove`, and `skills list`.
 * Install is symlink-only: `.agents/skills/<name>` becomes a symlink to
 * the source skill directory, and each agent-specific directory (e.g.
 * `.claude/skills/<name>`) is symlinked to the canonical `.agents/skills/<name>`
 * — politty never writes to `SKILL.md`. The ownership stamp
 * `metadata["politty-cli"] = "{package}:{cliName}"` must be authored by
 * the skill package itself; `add` and `sync` verify it before installing
 * and `remove` and `sync` consult it before deleting, so this CLI never
 * clobbers skills another tool installed.
 *
 * @throws if `command.subCommands.skills` already exists — silently
 *   overwriting it would hide a configuration bug.
 */
export function withSkillCommand<T extends AnyCommand>(
  command: T,
  options: SkillCommandOptions,
): T {
  if (command.subCommands && Object.hasOwn(command.subCommands, "skills")) {
    throw new Error(
      `withSkillCommand: command "${command.name}" already defines a "skills" subcommand.`,
    );
  }

  const cliName = command.name;
  const skillsSubCommand = defineCommand({
    name: "skills",
    description: "Manage agent skills",
    subCommands: {
      sync: createSkillSyncCommand(options, cliName),
      add: createSkillAddCommand(options, cliName),
      remove: createSkillRemoveCommand(options, cliName),
      list: createSkillListCommand(options, cliName),
    },
  });

  return {
    ...command,
    subCommands: {
      ...command.subCommands,
      skills: skillsSubCommand,
    },
  } as T;
}
