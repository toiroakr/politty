/**
 * Skill management module for coding agent CLIs.
 *
 * Provides utilities to manage SKILL.md-based skills following
 * the vercel-labs/skills format. Skills are distributed via npm packages
 * and synced to the project using the `skill sync` command.
 *
 * The SKILL.md frontmatter is extended with a `package` field for
 * tracking which npm package each skill originated from. This enables
 * detection of skill removals when a package drops a skill.
 *
 * @example
 * ```typescript
 * import { defineCommand, runMain } from "politty";
 * import { withSkillCommand } from "politty/skill";
 *
 * const cli = withSkillCommand(
 *   defineCommand({
 *     name: "my-agent",
 *     description: "My coding agent CLI",
 *     subCommands: {
 *       run: runCommand,
 *     },
 *   }),
 *   {
 *     sourceDirs: [
 *       require.resolve("@my-agent/skills/skills"),
 *     ],
 *   },
 * );
 *
 * runMain(cli);
 * ```
 *
 * SKILL.md format:
 * ```markdown
 * ---
 * name: commit
 * description: Git commit message generation
 * package: "@my-agent/skills"
 * ---
 * # Instructions for the agent...
 * ```
 *
 * @packageDocumentation
 */

import { defineCommand } from "../core/command.js";
import type { AnyCommand } from "../types.js";
import { createSkillListCommand, createSkillSyncCommand } from "./commands.js";
import type { SkillCommandOptions } from "./types.js";

// Public API re-exports
export { parseFrontmatter, parseSkillMd, skillFrontmatterSchema } from "./frontmatter.js";
export { scanInstalledSkills, scanSourceDirs } from "./scanner.js";
export { syncSkills } from "./sync.js";
export type {
  DiscoveredSkill,
  InstalledSkill,
  SkillCommandOptions,
  SkillFrontmatter,
  SyncResult,
} from "./types.js";

/**
 * Wrap a command with a `skill` subcommand for managing SKILL.md-based skills.
 *
 * Adds `skill sync` and `skill list` subcommands that discover skills from
 * npm package source directories and install them to `.agents/skills/`.
 *
 * @param command - The root command to wrap
 * @param options - Skill command configuration
 * @returns The command with `skill` subcommand added
 *
 * @example
 * ```typescript
 * const cli = withSkillCommand(
 *   defineCommand({
 *     name: "my-agent",
 *     subCommands: { run: runCommand },
 *   }),
 *   {
 *     sourceDirs: [require.resolve("@my-agent/skills/skills")],
 *   },
 * );
 * ```
 */
export function withSkillCommand<T extends AnyCommand>(
  command: T,
  options: SkillCommandOptions,
): T {
  const wrappedCommand = {
    ...command,
  } as T;

  wrappedCommand.subCommands = {
    ...command.subCommands,
    skill: defineCommand({
      name: "skill",
      description: "Manage agent skills",
      subCommands: {
        sync: createSkillSyncCommand(options),
        list: createSkillListCommand(options),
      },
    }),
  };

  return wrappedCommand;
}
