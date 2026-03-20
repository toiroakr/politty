/**
 * Skill management module for coding agent CLIs.
 *
 * Wraps vercel-labs/skills by providing source directory scanning
 * and package-based filtering. The actual installation and removal
 * of skills is delegated to `npx skills`.
 *
 * The SKILL.md frontmatter is extended with a `package` field for
 * tracking which npm package each skill originated from. This enables
 * package-level operations like removing all skills from a package.
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
import {
  createSkillAddCommand,
  createSkillListCommand,
  createSkillRemoveCommand,
} from "./commands.js";
import type { SkillCommandOptions } from "./types.js";

// Public API re-exports
export { parseFrontmatter, parseSkillMd, skillFrontmatterSchema } from "./frontmatter.js";
export { scanSourceDirs } from "./scanner.js";
export type {
  DiscoveredSkill,
  InstalledSkill,
  SkillCommandOptions,
  SkillFrontmatter,
} from "./types.js";

/**
 * Wrap a command with a `skill` subcommand for managing SKILL.md-based skills.
 *
 * Adds `skill add`, `skill remove`, and `skill list` subcommands.
 * Installation and removal are delegated to vercel-labs/skills (`npx skills`).
 * politty provides source directory scanning (local path resolution) and
 * package-based filtering for removal.
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
    skills: defineCommand({
      name: "skills",
      description: "Manage agent skills",
      subCommands: {
        add: createSkillAddCommand(options),
        remove: createSkillRemoveCommand(options),
        list: createSkillListCommand(options),
      },
    }),
  };

  return wrappedCommand;
}
