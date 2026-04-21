import { readdirSync, type Dirent } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { arg } from "../core/arg-registry.js";
import { defineCommand } from "../core/command.js";
import { logger, symbols } from "../output/logger.js";
import {
  AGENTS_SKILLS_DIR,
  installSkill,
  OWNERSHIP_METADATA_KEY,
  readInstalledOwnership,
  uninstallSkill,
} from "./installer.js";
import { scanSourceDir } from "./scanner.js";
import type { DiscoveredSkill, ScanError, ScanResult, SkillCommandOptions } from "./types.js";

/**
 * Build the `"{package}:{cli}"` ownership stamp stored in the installed
 * SKILL.md's `metadata["politty-cli"]`.
 */
function ownershipFor(options: SkillCommandOptions, cliName: string): string {
  return `${options.package}:${cliName}`;
}

function logScanErrors(errors: ScanError[]): void {
  for (const err of errors) {
    logger.warn(`Skipping skill at ${err.path}: ${err.message}`);
  }
}

function loadSkills(options: SkillCommandOptions): ScanResult {
  const result = scanSourceDir(options.sourceDir);
  logScanErrors(result.errors);
  return result;
}

/**
 * Create the `skills sync` subcommand.
 *
 * Removes and reinstalls all skills discovered in sourceDir. Skills owned
 * by this CLI that are no longer present in sourceDir are also removed so
 * stale skills do not linger after the CLI drops them from its bundle.
 */
export function createSkillSyncCommand(options: SkillCommandOptions, cliName: string) {
  return defineCommand({
    name: "sync",
    description: "Remove and reinstall all skills from source",
    args: z.object({
      exclude: arg(z.array(z.string()).default([]), {
        alias: "e",
        description: "Skill names to exclude from sync",
      }),
    }),
    run(args) {
      const { skills: allSkills, errors } = loadSkills(options);
      const excluded = new Set(args.exclude);
      const skills = allSkills.filter((s) => !excluded.has(s.frontmatter.name));
      const stamp = ownershipFor(options, cliName);

      // Refuse orphan reconciliation when the scan itself could not produce
      // an authoritative view of "what this CLI bundles":
      //   * `missing-source` — sourceDir missing or not a directory.
      //   * any error whose `path === sourceDir` — includes the
      //     single-skill-source case where sourceDir's own SKILL.md failed
      //     to parse; without a single valid skill there, we cannot tell
      //     orphan-vs-intentionally-dropped.
      // Per-skill errors on *subdirectories* (parse-failed, name-mismatch,
      // a single unreadable SKILL.md) do not block cleanup: the remaining
      // valid siblings still provide an authoritative bundle listing.
      const directoryScanFailed = errors.some(
        (e) => e.reason === "missing-source" || e.path === options.sourceDir,
      );

      if (!directoryScanFailed) {
        // Remove skills we previously owned that the CLI no longer bundles.
        const sourceNames = new Set(skills.map((s) => s.frontmatter.name));
        for (const orphan of findOwnedInstalledSkills(stamp)) {
          if (sourceNames.has(orphan) || excluded.has(orphan)) continue;
          removeOwnedSkill(orphan, stamp);
        }
      }

      // Reinstall in-place. `installSkill` stages into a temp sibling and
      // `rename`s the staged copy over the canonical directory, so a
      // remove-all-first pass is not needed. `addSkill`'s ownership guard
      // still refuses to clobber skills owned by another CLI.
      for (const skill of skills) {
        addSkill(skill, stamp);
      }
    },
  });
}

/**
 * Create the `skills add` subcommand.
 *
 * Installs skills from sourceDir. Defaults to all skills if no name is given.
 */
export function createSkillAddCommand(options: SkillCommandOptions, cliName: string) {
  return defineCommand({
    name: "add",
    description: "Install skills from source",
    args: z.object({
      name: arg(z.string().optional(), {
        positional: true,
        description: "Skill name to install (default: all)",
        placeholder: "NAME",
      }),
    }),
    run(args) {
      const { skills: sourceSkills } = loadSkills(options);
      const stamp = ownershipFor(options, cliName);

      if (args.name) {
        // Validate the user's request against available skills before
        // checking for emptiness — so a typo surfaces a useful error even
        // if the source dir is misconfigured.
        const skill = findOrThrow(sourceSkills, args.name);
        addSkill(skill, stamp);
        return;
      }

      if (sourceSkills.length === 0) {
        logger.info("No skills found in source directory.");
        return;
      }

      for (const skill of sourceSkills) {
        addSkill(skill, stamp);
      }
    },
  });
}

/**
 * Create the `skills remove` subcommand.
 *
 * Removes installed skills. Defaults to all skills discovered in sourceDir
 * if no name is given. Only skills stamped with this CLI's ownership
 * (`metadata["politty-cli"] === "{package}:{cli}"`) are removed — skills
 * another tool installed are left untouched.
 */
export function createSkillRemoveCommand(options: SkillCommandOptions, cliName: string) {
  return defineCommand({
    name: "remove",
    description: "Remove installed skills",
    args: z.object({
      name: arg(z.string().optional(), {
        positional: true,
        description: "Skill name to remove (default: all)",
        placeholder: "NAME",
      }),
    }),
    run(args) {
      const { skills: sourceSkills } = loadSkills(options);
      const stamp = ownershipFor(options, cliName);

      if (args.name) {
        // If sourceDir still knows this specific name, validate it for a
        // clearer error message; otherwise fall through to direct-by-name
        // removal so users can clean up an orphan the CLI has since dropped
        // even when other skills are still bundled.
        if (sourceSkills.some((s) => s.frontmatter.name === args.name)) {
          findOrThrow(sourceSkills, args.name);
        }
        removeOwnedSkill(args.name, stamp);
        return;
      }

      for (const skill of sourceSkills) {
        removeOwnedSkill(skill.frontmatter.name, stamp);
      }
    },
  });
}

/**
 * Create the `skills list` subcommand.
 *
 * Lists available skills from the source directory.
 */
export function createSkillListCommand(options: SkillCommandOptions, cliName: string) {
  return defineCommand({
    name: "list",
    description: "List available skills from source",
    args: z.object({
      json: arg(z.boolean().default(false), {
        description: "Output as JSON",
      }),
    }),
    run(args) {
      const { skills: sourceSkills } = loadSkills(options);
      const stamp = ownershipFor(options, cliName);

      if (args.json) {
        console.log(
          JSON.stringify(
            sourceSkills.map((s) => ({
              name: s.frontmatter.name,
              description: s.frontmatter.description,
              owner: stamp,
              sourcePath: s.sourcePath,
            })),
          ),
        );
        return;
      }

      if (sourceSkills.length === 0) {
        logger.info("No skills found in source directory.");
        return;
      }

      logger.info("Available skills:");
      for (const skill of sourceSkills) {
        logger.info(`  ${skill.frontmatter.name.padEnd(20)} ${skill.frontmatter.description}`);
      }
    },
  });
}

function findOrThrow(skills: DiscoveredSkill[], name: string): DiscoveredSkill {
  const skill = skills.find((s) => s.frontmatter.name === name);
  if (!skill) {
    const available = skills.map((s) => s.frontmatter.name).join(", ") || "<none>";
    throw new Error(`Skill "${name}" not found in source directory. Available: ${available}`);
  }
  return skill;
}

function addSkill(skill: DiscoveredSkill, ownership: string): void {
  const name = skill.frontmatter.name;
  // Refuse to clobber a skill owned by another CLI. installSkill() rewrites
  // the canonical directory unconditionally, so without this guard `add`
  // would silently overwrite a skill some other tool manages (and steal
  // ownership by stamping our `{package}:{cli}` over theirs).
  const actual = readInstalledOwnership(name);
  if (actual !== null && actual !== ownership) {
    throw new Error(
      `Refusing to install "${name}": owned by ${JSON.stringify(actual)}, ` +
        `not ${JSON.stringify(ownership)}. ` +
        `Check metadata.${OWNERSHIP_METADATA_KEY} in .agents/skills/${name}/SKILL.md.`,
    );
  }
  installSkill(skill, ownership);
  logger.info(`${symbols.success} Installed ${name}`);
}

/**
 * Remove a skill only if it belongs to this CLI (ownership stamp matches
 * `{package}:{cli}`). No-op when the skill isn't installed or has no stamp.
 *
 * Throws when the skill exists but is owned by someone else — callers
 * like `sync` that iterate silently would otherwise clobber user data.
 */
function removeOwnedSkill(name: string, expectedOwnership: string): void {
  const actual = readInstalledOwnership(name);
  if (actual === null) return;
  if (actual !== expectedOwnership) {
    throw new Error(
      `Refusing to remove "${name}": owned by ${JSON.stringify(actual)}, ` +
        `not ${JSON.stringify(expectedOwnership)}. ` +
        `Check metadata.${OWNERSHIP_METADATA_KEY} in .agents/skills/${name}/SKILL.md.`,
    );
  }
  uninstallSkill(name);
  logger.info(`${symbols.success} Removed ${name}`);
}

/**
 * Enumerate installed skills that carry this CLI's ownership stamp.
 * Used by `sync` to find orphans (skills the CLI previously bundled but
 * has since dropped).
 */
function findOwnedInstalledSkills(
  expectedOwnership: string,
  cwd: string = process.cwd(),
): string[] {
  const base = resolve(cwd, AGENTS_SKILLS_DIR);
  const owned: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return owned;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    // Legacy installs or other tools can leave spec-incompatible names in
    // this directory; readInstalledOwnership() throws on those. Skip rather
    // than crash sync — we only care about names this CLI could have
    // produced, and those are all spec-compliant by construction.
    let owner: string | null;
    try {
      owner = readInstalledOwnership(entry.name, cwd);
    } catch {
      continue;
    }
    if (owner === expectedOwnership) {
      owned.push(entry.name);
    }
  }
  return owned;
}
