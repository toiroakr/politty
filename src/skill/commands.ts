import { lstatSync, readdirSync, type Dirent } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { arg, type RegularArgMeta } from "../core/arg-registry.js";
import { defineCommand } from "../core/command.js";
import { logger, symbols } from "../output/logger.js";
import {
  AGENTS_SKILLS_DIR,
  hasInstalledSkill,
  installSkill,
  OWNERSHIP_METADATA_KEY,
  readInstalledOwnership,
  uninstallSkill,
} from "./installer.js";
import { resolveSkillOptions, type ResolvedSkillOptions } from "./options.js";
import { scanSourceDir } from "./scanner.js";
import type {
  DiscoveredSkill,
  InstallMode,
  ScanError,
  ScanResult,
  SkillCommandOptions,
} from "./types.js";

/**
 * Build the `"{package}:{cli}"` ownership stamp stored in the installed
 * SKILL.md's `metadata["politty-cli"]`.
 */
function ownershipFor(options: ResolvedSkillOptions, cliName: string): string {
  return `${options.package}:${cliName}`;
}

/**
 * Stream scan errors. Per-error `logger.warn` writes to stderr (so a
 * malformed source SKILL.md is always loud), and a single trailing
 * `logger.info` summary echoes the count to stdout — important for
 * pipelines that consume only stdout from the CLI.
 */
function logScanErrors(errors: ScanError[]): void {
  let skipped = 0;
  for (const err of errors) {
    if (err.reason === "missing-source") {
      // Directory-level failure; not a per-skill skip.
      logger.warn(`Failed to scan source directory ${err.path}: ${err.message}`);
      continue;
    }
    skipped += 1;
    logger.warn(`Skipping skill at ${err.path}: ${err.message}`);
  }
  if (skipped > 0) {
    logger.info(
      `${symbols.warning} Skipped ${skipped} skill(s) due to scan errors (see warnings above).`,
    );
  }
}

function loadSkills(options: ResolvedSkillOptions): ScanResult {
  const result = scanSourceDir(options.sourceDir);
  logScanErrors(result.errors);
  return result;
}

/**
 * Build the metadata for `--exclude` honouring the configured alias.
 * `undefined` alias means `arg()` is called without an alias key.
 */
function excludeArgMeta(options: ResolvedSkillOptions): RegularArgMeta<string[]> {
  const meta: RegularArgMeta<string[]> = {
    description: "Skill names to exclude from sync",
  };
  if (options.excludeAlias !== undefined) {
    meta.alias = options.excludeAlias;
  }
  return meta;
}

/**
 * Create the `skills sync` subcommand.
 *
 * Removes and reinstalls all skills discovered in sourceDir. Skills owned
 * by this CLI that are no longer present in sourceDir are also removed so
 * stale skills do not linger after the CLI drops them from its bundle.
 */
export function createSkillSyncCommand(options: SkillCommandOptions, cliName: string) {
  const resolved = resolveSkillOptions(options, cliName);
  return defineCommand({
    name: "sync",
    description: "Remove and reinstall all skills from source",
    args: z.object({
      exclude: arg(z.array(z.string()).default([]), excludeArgMeta(resolved)),
      verbose: arg(z.boolean().default(false), {
        alias: "v",
        description: "Print install paths and modes",
      }),
    }),
    run(args) {
      const { skills: allSkills, errors } = loadSkills(resolved);
      const excluded = new Set(args.exclude);
      const skills = allSkills.filter((s) => !excluded.has(s.frontmatter.name));
      const stamp = ownershipFor(resolved, cliName);

      // Refuse orphan reconciliation when the scan itself could not produce
      // an authoritative view of "what this CLI bundles":
      //   * `missing-source` — sourceDir missing or not a directory.
      //   * any error whose `path === sourceDir` — includes the
      //     single-skill-source case where sourceDir's own SKILL.md failed
      //     to parse; without a single valid skill there, we cannot tell
      //     orphan-vs-intentionally-dropped.
      //   * every discovered SKILL.md failed validation (errors > 0 but no
      //     valid skill returned) — we would otherwise interpret a totally
      //     broken bundle as "CLI ships nothing" and rm every owned install.
      //     Check `allSkills` (pre-exclusion), not `skills`, so excluding
      //     the only valid skill does not flip the bundle to "invalid" when
      //     an unrelated per-skill error is present.
      // Per-skill errors on *subdirectories* alongside at least one valid
      // skill do not block cleanup: the valid siblings still provide an
      // authoritative bundle listing.
      const directoryScanFailed = errors.some(
        (e) => e.reason === "missing-source" || e.path === resolved.sourceDir,
      );
      const allSkillsInvalid = errors.length > 0 && allSkills.length === 0;

      let removed = 0;
      if (!directoryScanFailed && !allSkillsInvalid) {
        // Remove skills we previously owned that the CLI no longer bundles.
        const sourceNames = new Set(skills.map((s) => s.frontmatter.name));
        for (const orphan of findOwnedInstalledSkills(stamp, resolved.cwd)) {
          if (sourceNames.has(orphan) || excluded.has(orphan)) continue;
          removeOwnedSkill(orphan, stamp, resolved.cwd);
          removed += 1;
        }
      }

      // Reinstall in-place. `installSkill` clears the slot before
      // writing, so a remove-all-first pass is not needed. `addSkill`'s
      // ownership guard still refuses to clobber skills owned by another CLI.
      let installed = 0;
      for (const skill of skills) {
        addSkill(skill, stamp, resolved, args.verbose);
        installed += 1;
      }

      // Sync is the canonical "make it match the bundle" operation; an
      // empty bundle or a fully-excluded run was previously silent. Always
      // print a summary so users know the no-op was intentional.
      if (installed === 0 && removed === 0) {
        const reason =
          allSkills.length > 0 && skills.length === 0 ? "all skills excluded" : "no skills bundled";
        logger.info(`No skills installed (${reason}).`);
      } else {
        logger.info(`Sync complete: ${installed} installed, ${removed} removed.`);
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
  const resolved = resolveSkillOptions(options, cliName);
  return defineCommand({
    name: "add",
    description: "Install skills from source",
    args: z.object({
      name: arg(z.string().optional(), {
        positional: true,
        description: "Skill name to install (default: all)",
        placeholder: "NAME",
      }),
      verbose: arg(z.boolean().default(false), {
        alias: "v",
        description: "Print install paths and modes",
      }),
    }),
    run(args) {
      const { skills: sourceSkills } = loadSkills(resolved);
      const stamp = ownershipFor(resolved, cliName);

      if (args.name) {
        // Validate the user's request against available skills before
        // checking for emptiness — so a typo surfaces a useful error even
        // if the source dir is misconfigured.
        const skill = findOrThrow(sourceSkills, args.name);
        addSkill(skill, stamp, resolved, args.verbose);
        return;
      }

      if (sourceSkills.length === 0) {
        logger.info("No skills found in source directory.");
        return;
      }

      for (const skill of sourceSkills) {
        addSkill(skill, stamp, resolved, args.verbose);
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
  const resolved = resolveSkillOptions(options, cliName);
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
      const { skills: sourceSkills } = loadSkills(resolved);
      const stamp = ownershipFor(resolved, cliName);

      if (args.name) {
        // If sourceDir still knows this specific name, validate it for a
        // clearer error message; otherwise fall through to direct-by-name
        // removal so users can clean up an orphan the CLI has since dropped
        // even when other skills are still bundled.
        if (sourceSkills.some((s) => s.frontmatter.name === args.name)) {
          findOrThrow(sourceSkills, args.name);
        }
        const removed = removeOwnedSkill(args.name, stamp, resolved.cwd);
        if (!removed) {
          logger.info(`${args.name} is not installed; nothing to remove.`);
        }
        return;
      }

      if (sourceSkills.length === 0) {
        logger.info("No skills found in source directory; nothing to remove.");
        return;
      }

      let removed = 0;
      for (const skill of sourceSkills) {
        if (removeOwnedSkill(skill.frontmatter.name, stamp, resolved.cwd)) {
          removed += 1;
        }
      }
      if (removed === 0) {
        logger.info("No installed skills owned by this CLI; nothing to remove.");
      }
    },
  });
}

/**
 * Status of a source skill in this project's install tree.
 *
 * - `installed` — installed and stamped by this CLI.
 * - `not-installed` — `.agents/skills/<name>` is absent.
 * - `foreign` — installed but stamped by another CLI; `add`/`sync` will
 *   refuse to overwrite it.
 * - `unstamped` — installed without any `politty-cli` stamp (legacy or
 *   manual install); `add` refuses to clobber it.
 * - `missing` — `.agents/skills/<name>` exists but the canonical symlink
 *   is broken (source package uninstalled).
 */
type ListStatus = "installed" | "not-installed" | "foreign" | "unstamped" | "missing";

function listStatus(name: string, expectedOwnership: string, cwd: string): ListStatus {
  let owner: string | null;
  try {
    owner = readInstalledOwnership(name, cwd);
  } catch {
    // Permission errors etc. — treat as unstamped so the user sees a
    // surfaceable signal in the list rather than a hard crash.
    return "unstamped";
  }
  if (owner === expectedOwnership) return "installed";
  if (owner !== null) return "foreign";
  // owner === null: distinguish "not installed" vs "installed unstamped"
  // vs "installed but symlink broken".
  if (!hasInstalledSkill(name, cwd)) {
    // hasInstalledSkill returns false for both "absent" and "broken
    // canonical symlink". Disambiguate via a direct lstat on the slot.
    return slotPresent(name, cwd) ? "missing" : "not-installed";
  }
  return "unstamped";
}

function slotPresent(name: string, cwd: string): boolean {
  try {
    lstatSync(resolve(cwd, AGENTS_SKILLS_DIR, name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the `skills list` subcommand.
 *
 * Lists available skills from the source directory.
 */
export function createSkillListCommand(options: SkillCommandOptions, cliName: string) {
  const resolved = resolveSkillOptions(options, cliName);
  return defineCommand({
    name: "list",
    description: "List available skills from source",
    args: z.object({
      json: arg(z.boolean().default(false), {
        description: "Output as JSON",
      }),
    }),
    run(args) {
      const { skills: sourceSkills } = loadSkills(resolved);
      const stamp = ownershipFor(resolved, cliName);

      if (args.json) {
        console.log(
          JSON.stringify(
            sourceSkills.map((s) => ({
              name: s.frontmatter.name,
              description: s.frontmatter.description,
              // `owner` is what the source SKILL.md actually declares; it
              // may be null or differ from `expectedOwner` when the
              // packaging is wrong, and in that case `skills add` refuses.
              // Surfacing both lets tooling detect the mismatch without
              // having to re-read SKILL.md.
              owner: s.frontmatter.metadata?.[OWNERSHIP_METADATA_KEY] ?? null,
              expectedOwner: stamp,
              status: listStatus(s.frontmatter.name, stamp, resolved.cwd),
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
        const status = listStatus(skill.frontmatter.name, stamp, resolved.cwd);
        logger.info(
          `  ${skill.frontmatter.name.padEnd(20)} ${status.padEnd(14)} ${skill.frontmatter.description}`,
        );
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

function addSkill(
  skill: DiscoveredSkill,
  expectedOwnership: string,
  resolved: ResolvedSkillOptions,
  verbose: boolean,
): void {
  const name = skill.frontmatter.name;
  const cwd = resolved.cwd;
  const mode: InstallMode | undefined = resolved.mode;
  // Validate the source skill's authored stamp before install. This is the
  // scanner-level correctness check that a skill package's SKILL.md
  // declares the expected `{package}:{cli}` ownership; a mismatch points
  // at a packaging bug, not a malicious actor.
  const sourceOwnership = skill.frontmatter.metadata?.[OWNERSHIP_METADATA_KEY] ?? null;
  if (sourceOwnership !== expectedOwnership) {
    throw new Error(
      `Refusing to install "${name}": source SKILL.md declares ` +
        `metadata.${OWNERSHIP_METADATA_KEY}=${JSON.stringify(sourceOwnership)}, ` +
        `expected ${JSON.stringify(expectedOwnership)}.`,
    );
  }
  // Refuse to clobber a skill canonical that another CLI owns. Because
  // `.agents/skills/<name>` is a symlink to the source package after
  // install, this effectively checks the other CLI's source stamp.
  const actual = readInstalledOwnership(name, cwd);
  if (actual !== null && actual !== expectedOwnership) {
    throw new Error(
      `Refusing to install "${name}": owned by ${JSON.stringify(actual)}, ` +
        `not ${JSON.stringify(expectedOwnership)}. ` +
        `Check metadata.${OWNERSHIP_METADATA_KEY} in .agents/skills/${name}/SKILL.md.`,
    );
  }
  // readInstalledOwnership returns null for both "not installed" and
  // "installed but unstamped" — we distinguish via hasInstalledSkill so
  // we don't silently rmSync a legacy/manual install we have no claim to.
  if (actual === null && hasInstalledSkill(name, cwd)) {
    throw new Error(
      `Refusing to install "${name}": .agents/skills/${name}/SKILL.md exists without a ` +
        `${OWNERSHIP_METADATA_KEY} stamp, so it was not installed by this CLI. ` +
        `Remove it manually (or add the stamp to take ownership) before running "skills add".`,
    );
  }
  installSkill(skill, cwd, mode === undefined ? {} : { mode });
  logger.info(`${symbols.success} Installed ${name}`);
  if (verbose) {
    const effectiveMode: InstallMode = mode ?? "symlink";
    const canonical = resolve(cwd, AGENTS_SKILLS_DIR, name);
    logger.info(`    mode=${effectiveMode}  path=${canonical}`);
  }
}

/**
 * Remove a skill only if it belongs to this CLI (ownership stamp matches
 * `{package}:{cli}`). Returns `true` when something was actually removed,
 * `false` when the skill was not installed (allowing callers to surface a
 * "nothing to remove" message).
 *
 * Throws when the skill exists but is owned by someone else — callers
 * like `sync` that iterate silently would otherwise clobber user data.
 */
function removeOwnedSkill(name: string, expectedOwnership: string, cwd: string): boolean {
  const actual = readInstalledOwnership(name, cwd);
  if (actual === null) return false;
  if (actual !== expectedOwnership) {
    throw new Error(
      `Refusing to remove "${name}": owned by ${JSON.stringify(actual)}, ` +
        `not ${JSON.stringify(expectedOwnership)}. ` +
        `Check metadata.${OWNERSHIP_METADATA_KEY} in .agents/skills/${name}/SKILL.md.`,
    );
  }
  uninstallSkill(name, cwd, { expectedOwnership });
  logger.info(`${symbols.success} Removed ${name}`);
  return true;
}

/**
 * Enumerate installed skills that carry this CLI's ownership stamp.
 * Used by `sync` to find orphans (skills the CLI previously bundled but
 * has since dropped).
 */
function findOwnedInstalledSkills(expectedOwnership: string, cwd: string): string[] {
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
