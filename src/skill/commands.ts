import { existsSync, lstatSync, readdirSync, unlinkSync, type Dirent } from "node:fs";
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
  SYMLINK_TARGETS,
  uninstallSkill,
} from "./installer.js";
import type { ResolvedSkillOptions } from "./options.js";
import { scanSourceDir } from "./scanner.js";
import type { DiscoveredSkill, InstallMode, ScanError, ScanResult } from "./types.js";

/**
 * Stream scan errors. Per-error `logger.warn` writes to stderr (so a
 * malformed source SKILL.md is always loud), and trailing `logger.info`
 * summary lines echo to stdout — important for pipelines that consume
 * only stdout from the CLI. Directory-level failures (`missing-source`,
 * or per-entry failures on the source directory itself) get their own
 * stdout summary so a stdout-only consumer can tell apart "scan failed"
 * from a legitimate empty bundle.
 */
function logScanErrors(errors: ScanError[]): void {
  let skipped = 0;
  let directoryFailed = false;
  for (const err of errors) {
    if (err.reason === "missing-source") {
      directoryFailed = true;
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
  if (directoryFailed) {
    logger.info(
      `${symbols.warning} Source directory scan failed (see warnings above); subsequent operations may be skipped.`,
    );
  }
}

/**
 * Did the scan fail authoritatively at the directory level? Used by
 * commands to distinguish "legitimately empty source" from "scan
 * couldn't enumerate the source", so success-path summaries
 * ("No skills found", "no skills bundled") don't mask a config error.
 */
function scanFailedAtRoot(result: ScanResult, sourceDir: string): boolean {
  const directoryScanFailed = result.errors.some(
    (e) => e.reason === "missing-source" || e.path === sourceDir,
  );
  const allSkillsInvalid = result.errors.length > 0 && result.skills.length === 0;
  return directoryScanFailed || allSkillsInvalid;
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
export function createSkillSyncCommand(resolved: ResolvedSkillOptions) {
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
      const stamp = resolved.stamp;
      // Pre-validate every `--exclude` value before any install side
      // effect. A typo (e.g. `--exclude nonexitent`) previously slid
      // through as a no-op; now it aborts the run with a single error
      // listing every unknown name so the user can fix the whole
      // invocation in one round-trip. Mirrors `skills add`'s unknown-name
      // handling.
      //
      // `--exclude` does double duty: it skips installation of a source
      // skill *and* protects an installed orphan (a skill this CLI owns
      // but no longer ships) from sync's removal pass. Both names are
      // legitimate, so accept either match before raising.
      const sourceNamesAll = new Set(allSkills.map((s) => s.frontmatter.name));
      const ownedInstalled = new Set(findOwnedInstalledSkills(stamp, resolved.cwd));
      const requestedExclude = Array.from(new Set(args.exclude));
      const unknownExclude = requestedExclude.filter(
        (n) => !sourceNamesAll.has(n) && !ownedInstalled.has(n),
      );
      if (unknownExclude.length > 0) {
        const subject = unknownExclude.length === 1 ? "Skill" : "Skills";
        const quoted = unknownExclude.map((n) => JSON.stringify(n)).join(", ");
        throw new Error(
          `--exclude: ${subject} ${quoted} not found in source directory ` +
            `or among installed skills.\n` +
            formatSkillUniverse({ source: allSkills, installed: ownedInstalled }),
        );
      }
      const excluded = new Set(args.exclude);
      const skills = allSkills.filter((s) => !excluded.has(s.frontmatter.name));

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
      const rootScanFailed = scanFailedAtRoot({ skills: allSkills, errors }, resolved.sourceDir);

      let removed = 0;
      if (!rootScanFailed) {
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
      // print a summary so users know the no-op was intentional, and
      // differentiate the scan-failure case so a stdout-only pipeline
      // doesn't misread "no skills bundled" as an intentional empty bundle.
      if (installed === 0 && removed === 0) {
        const reason = rootScanFailed
          ? "source directory scan failed; see warnings"
          : allSkills.length > 0 && skills.length === 0
            ? "all skills excluded"
            : "no skills bundled";
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
 * Installs skills from sourceDir. Accepts zero or more skill names; with no
 * names, installs every skill in source. With one or more names, every name
 * is validated against sourceSkills up-front so a typo never silently
 * proceeds with the valid neighbours — a single unknown name aborts the run
 * and lists every unknown name at once. Duplicates are deduplicated.
 */
export function createSkillAddCommand(resolved: ResolvedSkillOptions) {
  return defineCommand({
    name: "add",
    description: "Install skills from source",
    args: z.object({
      name: arg(z.array(z.string()).default([]), {
        positional: true,
        description: "Skill name(s) to install (default: all)",
        placeholder: "NAME",
      }),
      verbose: arg(z.boolean().default(false), {
        alias: "v",
        description: "Print install paths and modes",
      }),
    }),
    run(args) {
      const { skills: sourceSkills } = loadSkills(resolved);
      const stamp = resolved.stamp;

      if (args.name.length > 0) {
        // Pre-validate every requested name in one pass. A single unknown
        // name aborts the run before any install side effect, and we list
        // every unknown name so the user can fix the whole CLI invocation
        // in one round-trip rather than discovering typos one at a time.
        const known = new Set(sourceSkills.map((s) => s.frontmatter.name));
        const requested = Array.from(new Set(args.name));
        const unknown = requested.filter((n) => !known.has(n));
        if (unknown.length > 0) {
          const subject = unknown.length === 1 ? "Skill" : "Skills";
          const quoted = unknown.map((n) => JSON.stringify(n)).join(", ");
          throw new Error(
            `${subject} ${quoted} not found in source directory.\n` +
              formatSkillUniverse({ source: sourceSkills }),
          );
        }
        // Preserve source order for deterministic install logs even when
        // the user supplied names in arbitrary order.
        const wanted = new Set(requested);
        for (const skill of sourceSkills) {
          if (wanted.has(skill.frontmatter.name)) {
            addSkill(skill, stamp, resolved, args.verbose);
          }
        }
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
export function createSkillRemoveCommand(resolved: ResolvedSkillOptions) {
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
      const stamp = resolved.stamp;

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
          // `removeOwnedSkill` already cleaned up dangling-symlink slots,
          // so a `false` return with `slotPresent` true means the slot is
          // a real directory (or live symlink) without a recognisable
          // stamp — a legacy or manual install we won't touch.
          if (slotPresent(args.name, resolved.cwd)) {
            logger.info(
              `${args.name} is installed without a ${OWNERSHIP_METADATA_KEY} stamp this CLI recognises; ` +
                `refusing to remove. Remove .agents/skills/${args.name} manually if intended.`,
            );
          } else {
            const installed = new Set(findOwnedInstalledSkills(stamp, resolved.cwd));
            logger.info(
              `${args.name} is not installed; nothing to remove.\n` +
                formatSkillUniverse({ installed }),
            );
          }
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
export function createSkillListCommand(resolved: ResolvedSkillOptions) {
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
      const stamp = resolved.stamp;

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

/**
 * Render skill-name lists for typo-error diagnostics. Each command lists
 * only the universe its argument actually accepts so the suggestions
 * match what the user can legitimately retype:
 *   - `add` — source only.
 *   - `remove` — installed only.
 *   - `sync --exclude` — both (a source skill skips its install, an
 *     installed-owned orphan is preserved from removal).
 * Empty sections render as `<none>` so the user can tell apart "I don't
 * know about any" from "the message forgot a section".
 */
function formatSkillUniverse(opts: {
  source?: DiscoveredSkill[];
  installed?: ReadonlySet<string>;
}): string {
  const parts: string[] = [];
  if (opts.source !== undefined) {
    parts.push(`  Source: ${opts.source.map((s) => s.frontmatter.name).join(", ") || "<none>"}`);
  }
  if (opts.installed !== undefined) {
    parts.push(`  Installed: ${[...opts.installed].sort().join(", ") || "<none>"}`);
  }
  return parts.join("\n");
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
 * A broken canonical symlink (`.agents/skills/<name>` exists as a symlink
 * but its target does not) is also cleaned up here, even though
 * `readInstalledOwnership` returns `null` in that case — the slot is in
 * this CLI's namespace and unlinking a dangling symlink can never delete
 * user data. This matches the `status: "missing"` listed by `skills list`.
 *
 * Throws when the skill exists but is owned by someone else — callers
 * like `sync` that iterate silently would otherwise clobber user data.
 */
function removeOwnedSkill(name: string, expectedOwnership: string, cwd: string): boolean {
  const actual = readInstalledOwnership(name, cwd);
  if (actual === null) {
    // `actual === null` covers (a) not installed, (b) broken canonical
    // symlink, (c) installed-but-unstamped real directory. Only (b) is
    // safe to clean up here — (a) is already a no-op, (c) belongs to
    // someone else.
    if (cleanupBrokenSlot(name, cwd)) {
      logger.info(`${symbols.success} Removed ${name} (broken symlink)`);
      return true;
    }
    return false;
  }
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
 * If `.agents/skills/<name>` exists as a dangling symlink, unlink it (and
 * any agent-specific dangling-symlink slots that route through it).
 * Returns `true` when at least the canonical slot was cleaned. A live
 * symlink (target still resolves) is left alone — those go through the
 * normal stamp-checked path.
 */
function cleanupBrokenSlot(name: string, cwd: string): boolean {
  const canonical = resolve(cwd, AGENTS_SKILLS_DIR, name);
  if (!isDanglingSymlink(canonical)) return false;
  unlinkSync(canonical);
  // Best-effort sweep of agent-specific slots — they're symlinks back to
  // the canonical, so they're broken too once the canonical is gone (and
  // were already broken when the canonical's target disappeared).
  for (const target of SYMLINK_TARGETS) {
    const agentSlot = resolve(cwd, target, name);
    if (isDanglingSymlink(agentSlot)) unlinkSync(agentSlot);
  }
  return true;
}

function isDanglingSymlink(path: string): boolean {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return false;
  }
  if (!stat.isSymbolicLink()) return false;
  // existsSync follows symlinks; false here ⇒ target is gone.
  return !existsSync(path);
}

/**
 * Enumerate installed skills that should be reconciled by `sync`'s orphan
 * cleanup: skills carrying this CLI's ownership stamp, plus dangling
 * canonical symlinks (which were almost certainly left behind by a
 * previous install of this CLI and are safe to unlink).
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
      continue;
    }
    // Owner is unreadable. If the slot is a dangling symlink it's almost
    // certainly a leftover from a previous install of this CLI (real
    // directories never end up dangling). Include it so `sync` can clean
    // it up via `cleanupBrokenSlot`.
    if (owner === null && isDanglingSymlink(resolve(base, entry.name))) {
      owned.push(entry.name);
    }
  }
  return owned;
}
