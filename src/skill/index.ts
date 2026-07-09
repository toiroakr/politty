/**
 * Skill management module for coding agent CLIs.
 *
 * Provides source-directory scanning and symlink-based (or copy-based)
 * installation of SKILL.md-based agent skills, validated against the
 * Agent Skills specification (https://agentskills.io/specification).
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
import { resolveSkillOptions } from "./options.js";
import type { SkillCommandOptions, WithSkillCommand } from "./types.js";

// Public API re-exports
export { parseFrontmatter, parseSkillMd, skillFrontmatterSchema } from "./frontmatter.js";
export type { ParsedSkillMd } from "./frontmatter.js";
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
  InstallMode,
  InstallSkillOptions,
  ScanError,
  ScanErrorReason,
  ScanResult,
  SkillCommandOptions,
  SkillFlagOverrides,
  SkillFrontmatter,
  UninstallSkillOptions,
  WithSkillCommand,
} from "./types.js";

/**
 * Wrap a command with a `skills` subcommand for managing SKILL.md-based skills.
 *
 * Adds `skills sync`, `skills add`, `skills remove`, and `skills list`.
 * The install materialization is controlled by `options.mode`
 * (see {@link SkillCommandOptions}):
 *
 * - `"symlink"` (default) — symlink the source into place. Source updates
 *   propagate live. Install errors out with guidance to retry with `"copy"`
 *   when `symlinkSync` fails (e.g. Windows without Developer Mode).
 * - `"copy"` — recursive copy. Source updates require re-running sync.
 *
 * Under both modes the canonical slot is `.agents/skills/<name>` and each
 * agent-specific directory (e.g. `.claude/skills/<name>`) is populated
 * from that canonical slot. politty never writes to `SKILL.md`. The
 * ownership stamp `metadata["politty-cli"] = "{package}:{cliName}"` must
 * be authored by the skill package itself; `add` and `sync` verify it
 * before installing and `remove` / `sync` consult it before deleting, so
 * this CLI never clobbers skills another tool installed.
 *
 * @throws if `command.subCommands.skills` already exists — silently
 *   overwriting it would hide a configuration bug.
 */
export function withSkillCommand<T extends AnyCommand>(
  command: T,
  options: SkillCommandOptions,
): WithSkillCommand<T> {
  if (command.subCommands && Object.hasOwn(command.subCommands, "skills")) {
    throw new Error(
      `withSkillCommand: command "${command.name}" already defines a "skills" subcommand.`,
    );
  }

  const resolved = resolveSkillOptions(options, command.name);
  const addName = resolved.commandNames.add.name;
  const removeName = resolved.commandNames.remove.name;
  // Check every dispatched name AND alias together — an alias colliding with
  // another subcommand's name or alias is just as ambiguous as two primary
  // names colliding: `resolveSubcommandWithAlias` resolves the direct key
  // first, so an alias shadowed by another subcommand's name is silently
  // unreachable, and `resolveSubCommandAlias` returns the first match when
  // two subcommands share an alias, silently dropping the other.
  const allNames = [
    "sync",
    "list",
    addName,
    ...resolved.commandNames.add.aliases,
    removeName,
    ...resolved.commandNames.remove.aliases,
  ];
  const duplicate = allNames.find((name, i) => allNames.indexOf(name) !== i);
  if (duplicate) {
    throw new Error(
      `withSkillCommand: commandMap produced duplicate subcommand name/alias "${duplicate}".`,
    );
  }

  const skillsSubCommand = defineCommand({
    name: "skills",
    description: "Manage agent skills",
    subCommands: {
      sync: createSkillSyncCommand(resolved),
      [addName]: createSkillAddCommand(resolved),
      [removeName]: createSkillRemoveCommand(resolved),
      list: createSkillListCommand(resolved),
    },
  });

  return {
    ...command,
    description: appendDescription(command.description, resolved.descriptionAppend),
    subCommands: {
      ...command.subCommands,
      skills: skillsSubCommand,
    },
  } as unknown as WithSkillCommand<T>;
}

/**
 * Append the configured skills hint to the root command's description.
 *
 * Returns the original description unchanged when `append` is `false` or
 * empty. When the existing description already ends with the same hint,
 * skip the append so re-wrapping (e.g. in tests) does not duplicate it.
 *
 * The separator is a blank line so help renderers display the hint as
 * its own paragraph — a single space would run the hint into the host
 * description (especially when the description has no trailing period).
 */
function appendDescription(
  existing: string | undefined,
  append: string | false,
): string | undefined {
  if (append === false || append === "") return existing;
  if (!existing) return append;
  if (existing.endsWith(append)) return existing;
  return `${existing}\n\n${append}`;
}
