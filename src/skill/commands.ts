import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  unlinkSync,
  type Dirent,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
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
 *
 * `silentStdout` suppresses only the stdout summary lines (per-error
 * stderr warnings still fire). Used by `skills list --json` so the
 * machine-readable JSON output on stdout stays parseable.
 */
function logScanErrors(
  errors: ScanError[],
  opts: { silentStdout?: boolean; sourceDir?: string } = {},
): void {
  let skipped = 0;
  let directoryFailed = false;
  for (const err of errors) {
    // `missing-source` is always a directory failure. `read-failed` with
    // `path === sourceDir` is also a directory failure (e.g. EACCES on
    // `readdirSync(sourceDir)`); without checking the path, such errors
    // would render as a single "Skipping skill" line and silently skip
    // the directory-failed stdout summary — confusing a broken source
    // directory for one malformed skill.
    if (err.reason === "missing-source" || err.path === opts.sourceDir) {
      directoryFailed = true;
      logger.warn(`Failed to scan source directory ${err.path}: ${err.message}`);
      continue;
    }
    skipped += 1;
    logger.warn(`Skipping skill at ${err.path}: ${err.message}`);
  }
  if (opts.silentStdout) return;
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

function loadSkills(
  options: ResolvedSkillOptions,
  logOpts: { silentStdout?: boolean } = {},
): ScanResult {
  const result = scanSourceDir(options.sourceDir);
  logScanErrors(result.errors, { ...logOpts, sourceDir: options.sourceDir });
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
      // effect. A typo (e.g. `--exclude nonexistent`) previously slid
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
      const ownedInstalled = new Set(
        findOwnedInstalledSkills(stamp, resolved.cwd, resolved.sourceDir),
      );
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
        // Errored source subdirectories are *retained*: an installed slot
        // whose source SKILL.md is currently unreadable / malformed must
        // not be reaped as an orphan — the source entry still exists, it
        // just couldn't be scanned this run. Without this guard a transient
        // packaging issue (one broken SKILL.md alongside healthy siblings)
        // would silently rm-rf the install for the broken one.
        //
        // For most reasons the install slot matches the subdirectory name
        // (spec-mandated equality). For `name-mismatch`, though, the two
        // diverge — only one side was just renamed — and the prior install
        // could be at either the directory basename *or* the frontmatter
        // name, depending on which side moved. Protect both so a transient
        // rename mistake never reaps the live install.
        const sourceNames = new Set(skills.map((s) => s.frontmatter.name));
        const erroredSlotNames = new Set<string>();
        for (const err of errors) {
          if (err.path === resolved.sourceDir) continue;
          erroredSlotNames.add(basename(err.path));
          if (err.skillName !== undefined) erroredSlotNames.add(err.skillName);
        }
        for (const orphan of ownedInstalled) {
          if (sourceNames.has(orphan) || excluded.has(orphan) || erroredSlotNames.has(orphan)) {
            continue;
          }
          removeOwnedSkill(orphan, stamp, resolved.cwd, resolved.sourceDir);
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
    aliases: ["install"],
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
      const scanResult = loadSkills(resolved);
      const sourceSkills = scanResult.skills;
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
        // Differentiate a directory-level scan failure from a legitimately
        // empty source so a stdout-only consumer doesn't read a misconfigured
        // sourceDir as "we have no skills to install".
        if (scanFailedAtRoot(scanResult, resolved.sourceDir)) {
          logger.info("No skills installed (source directory scan failed; see warnings).");
        } else {
          logger.info("No skills found in source directory.");
        }
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
    aliases: ["uninstall"],
    description: "Remove installed skills",
    args: z.object({
      name: arg(z.string().optional(), {
        positional: true,
        description: "Skill name to remove (default: all)",
        placeholder: "NAME",
      }),
    }),
    run(args) {
      const scanResult = loadSkills(resolved);
      const sourceSkills = scanResult.skills;
      const stamp = resolved.stamp;

      if (args.name) {
        // If sourceDir still knows this specific name, validate it for a
        // clearer error message; otherwise fall through to direct-by-name
        // removal so users can clean up an orphan the CLI has since dropped
        // even when other skills are still bundled.
        if (sourceSkills.some((s) => s.frontmatter.name === args.name)) {
          findOrThrow(sourceSkills, args.name);
        }
        const removed = removeOwnedSkill(args.name, stamp, resolved.cwd, resolved.sourceDir);
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
            const installed = new Set(
              findOwnedInstalledSkills(stamp, resolved.cwd, resolved.sourceDir),
            );
            logger.info(
              `${args.name} is not installed; nothing to remove.\n` +
                formatSkillUniverse({ installed }),
            );
          }
        }
        return;
      }

      if (sourceSkills.length === 0) {
        // Distinguish a legitimately empty bundle from a directory-level
        // scan failure so a stdout-only consumer doesn't read a broken
        // sourceDir as "we have no skills to remove" — mirrors the
        // branching `add`/`list`/`sync` already do.
        if (scanFailedAtRoot(scanResult, resolved.sourceDir)) {
          logger.info(
            "No skills found (source directory scan failed; see warnings); nothing to remove.",
          );
        } else {
          logger.info("No skills found in source directory; nothing to remove.");
        }
        return;
      }

      let removed = 0;
      for (const skill of sourceSkills) {
        if (removeOwnedSkill(skill.frontmatter.name, stamp, resolved.cwd, resolved.sourceDir)) {
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
 *   manual install, or a real directory at the slot without a readable
 *   SKILL.md); `add` refuses to clobber it.
 * - `missing` — `.agents/skills/<name>` is a dangling canonical symlink
 *   (source package uninstalled); `removeOwnedSkill` can clean it up.
 * - `unreadable` — `.agents/skills/<name>/SKILL.md` exists but could not
 *   be read (EACCES / EPERM / IO). Distinguished from `unstamped` so users
 *   can tell apart "no stamp" from "cannot read the file at all".
 */
type ListStatus =
  | "installed"
  | "not-installed"
  | "foreign"
  | "unstamped"
  | "missing"
  | "unreadable";

function listStatus(
  name: string,
  expectedOwnership: string,
  cwd: string,
  sourceDir: string,
): ListStatus {
  let owner: string | null;
  try {
    owner = readInstalledOwnership(name, cwd);
  } catch (error) {
    // IO errors (EACCES / EPERM / generic read failure) on the SKILL.md
    // are not the same thing as a missing stamp. Surface as a distinct
    // status with a warning so the user can act on the root cause rather
    // than silently misreading it as "unstamped".
    logger.warn(`Failed to read ownership for installed skill ${name}: ${errorMessage(error)}`);
    return "unreadable";
  }
  if (owner === expectedOwnership) return "installed";
  if (owner !== null) return "foreign";
  // owner === null: distinguish "not installed" vs "installed unstamped"
  // vs "installed but symlink broken".
  if (!hasInstalledSkill(name, cwd)) {
    // hasInstalledSkill returns false for "absent", "broken canonical
    // symlink", and "real slot without a SKILL.md". Only dangling symlinks
    // that still route into *our* `sourceDir` qualify as `missing`,
    // because that's the only state `removeOwnedSkill`/`cleanupBrokenSlot`
    // can actually clean up — `.agents/skills/` is a shared namespace,
    // and a dangling symlink pointing at another politty-based CLI's
    // (now-uninstalled) source belongs to that CLI. Reporting it as
    // `missing` would promise a sweep the cleanup path will refuse.
    const canonical = resolve(cwd, AGENTS_SKILLS_DIR, name);
    if (isDanglingSymlink(canonical) && danglingRoutesToSource(canonical, sourceDir)) {
      return "missing";
    }
    return slotPresent(name, cwd) ? "unstamped" : "not-installed";
  }
  return "unstamped";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      // In `--json` mode, suppress stdout summary lines from the scan-error
      // logger so the JSON array on stdout stays parseable. Per-error
      // stderr warnings still fire so the operator can see what was skipped.
      const scanResult = loadSkills(resolved, { silentStdout: args.json });
      const sourceSkills = scanResult.skills;
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
              status: listStatus(s.frontmatter.name, stamp, resolved.cwd, resolved.sourceDir),
              sourcePath: s.sourcePath,
            })),
          ),
        );
        return;
      }

      if (sourceSkills.length === 0) {
        // Same rationale as `skills add`: a stdout-only consumer must be
        // able to tell apart a legitimately empty source from a misconfigured
        // sourceDir that failed to scan.
        if (scanFailedAtRoot(scanResult, resolved.sourceDir)) {
          logger.info("Source directory scan failed; see warnings.");
        } else {
          logger.info("No skills found in source directory.");
        }
        return;
      }

      logger.info("Available skills:");
      for (const skill of sourceSkills) {
        const status = listStatus(skill.frontmatter.name, stamp, resolved.cwd, resolved.sourceDir);
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
  // "installed but unstamped" — refuse to clobber any slot we can't prove
  // we own. A readable but unstamped SKILL.md is one such case
  // (`hasInstalledSkill === true`); a live symlink whose target lacks a
  // SKILL.md is another (slot is occupied but `hasInstalledSkill === false`
  // because `existsSync` follows the symlink and finds no file). `listStatus`
  // already routes both to `unstamped`, so the install guard must match.
  // The one exception is a dangling canonical symlink that still routes to
  // this CLI's `sourceDir` — almost certainly a leftover from a previous
  // install of this CLI, and `installSkill` is expected to reap it. A
  // dangling symlink whose target lies outside our `sourceDir` is treated
  // like any other foreign occupant: `.agents/skills/` is shared across
  // politty-based CLIs, and without a stamp to read the route check is the
  // only signal that the dangling slot belongs to us.
  const canonical = resolve(cwd, AGENTS_SKILLS_DIR, name);
  const danglingOurs =
    isDanglingSymlink(canonical) && danglingRoutesToSource(canonical, resolved.sourceDir);
  if (actual === null && slotPresent(name, cwd) && !danglingOurs) {
    throw new Error(
      `Refusing to install "${name}": .agents/skills/${name} exists without a ` +
        `${OWNERSHIP_METADATA_KEY} stamp, so it was not installed by this CLI. ` +
        `Remove it manually (or add the stamp to take ownership) before running "skills add".`,
    );
  }
  installSkill(skill, cwd, mode === undefined ? {} : { mode });
  logger.info(`${symbols.success} Installed ${name}`);
  if (verbose) {
    const effectiveMode: InstallMode = mode ?? "symlink";
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
function removeOwnedSkill(
  name: string,
  expectedOwnership: string,
  cwd: string,
  sourceDir: string,
): boolean {
  const actual = readInstalledOwnership(name, cwd);
  if (actual === null) {
    // `actual === null` covers (a) not installed, (b) broken canonical
    // symlink, (c) installed-but-unstamped real directory. Only (b) is
    // safe to clean up here — (a) is already a no-op, (c) belongs to
    // someone else.
    if (cleanupBrokenSlot(name, cwd, sourceDir)) {
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
 * If `.agents/skills/<name>` is a dangling symlink that still routes to
 * this CLI's source directory, unlink it (and any agent-specific
 * dangling-symlink slots that route through it). Returns `true` when the
 * canonical slot was cleaned.
 *
 * A dangling canonical whose target lies outside our source directory
 * (e.g. a foreign politty-based CLI's stale install in the shared
 * `.agents/skills/` namespace) is left alone — without an ownership
 * stamp to read, we can't prove the slot belongs to this CLI. Live
 * symlinks (target still resolves) go through the normal stamp-checked
 * path.
 */
function cleanupBrokenSlot(name: string, cwd: string, sourceDir: string): boolean {
  const canonical = resolve(cwd, AGENTS_SKILLS_DIR, name);
  if (!isDanglingSymlink(canonical)) return false;
  if (!danglingRoutesToSource(canonical, sourceDir)) return false;
  // Sweep matching agent-specific slots *before* unlinking the canonical.
  // `symlinkRoutesTo`'s realpath fallback needs both endpoints to resolve
  // — once the canonical is gone (e.g. when `cwd` is a symlinked project
  // path so the install wrote realpath-resolved parents and the agent
  // link's resolved target no longer equals `canonical` lexically), the
  // sweep could no longer prove ownership and would leave the agent-slot
  // dangling symlink behind. Only slots that route back to our canonical
  // are reaped; a foreign tool's dangling symlink at the same agent path
  // (e.g. pointing at its own canonical) lives in the same shared
  // namespace and must not be touched.
  for (const target of SYMLINK_TARGETS) {
    const agentSlot = resolve(cwd, target, name);
    if (!isDanglingSymlink(agentSlot)) continue;
    if (symlinkRoutesTo(agentSlot, canonical)) {
      unlinkSync(agentSlot);
    }
  }
  unlinkSync(canonical);
  return true;
}

/**
 * Does the dangling symlink at `canonical` still route into `sourceDir`?
 * Used to confirm a stale `.agents/skills/<name>` belongs to this CLI
 * before we unlink it in the shared namespace.
 *
 * The link target is resolved lexically (the path is dangling so
 * `realpathSync` on it would fail) against the symlink's own directory.
 * `sourceDir` is resolved through `resolveDeepestExisting` so the
 * comparison survives realpath remapping (macOS `/tmp` →
 * `/private/tmp`, a project mounted through a symlink, etc) *and* the
 * documented case where the configured source path itself no longer
 * exists (the source package was uninstalled — exactly the scenario
 * `status: "missing"` is meant to surface). Containment uses the same
 * boundary-aware `..`-only escape check as `installer.ts`'s
 * `pathsOverlap` so a sibling directory whose name happens to start
 * with `..` is not misclassified as outside.
 */
function danglingRoutesToSource(canonical: string, sourceDir: string): boolean {
  let raw: string;
  try {
    raw = readlinkSync(canonical);
  } catch {
    return false;
  }
  const absoluteTarget = isAbsolute(raw) ? raw : resolve(dirname(canonical), raw);
  // The source dir itself may be gone (the source package was uninstalled
  // — the very state `status: "missing"` is meant to surface), so resolve
  // through the deepest existing ancestor instead of `realpathSync` to keep
  // routing-into-sourceDir recognizable even when the directory is absent.
  const resolvedSource = resolveDeepestExisting(resolve(sourceDir));
  // The target itself is dangling so `realpathSync(absoluteTarget)` would
  // fail. Resolve the deepest existing ancestor instead so the comparison
  // survives realpath remapping (macOS `/tmp` → `/private/tmp`, a project
  // mounted through a symlink, pnpm-style `node_modules`, etc).
  const resolvedTarget = resolveDeepestExisting(absoluteTarget);
  const rel = relative(resolvedSource, resolvedTarget);
  if (isAbsolute(rel)) return false;
  if (rel === ".." || rel.startsWith(`..${sep}`)) return false;
  return true;
}

function resolveDeepestExisting(p: string): string {
  let cur = p;
  const tail: string[] = [];
  while (true) {
    try {
      const r = realpathSync(cur);
      return tail.length === 0 ? r : resolve(r, ...tail.reverse());
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return p;
      tail.push(cur.slice(parent.length).replace(/^[/\\]+/, ""));
      cur = parent;
    }
  }
}

/**
 * Does the symlink at `slot` route to `expected` (lexically, with a
 * realpath fallback)? Mirrors `symlinkRoutesTo` in `installer.ts` —
 * deliberately a local duplicate so `commands.ts` does not depend on the
 * installer's private helpers.
 */
function symlinkRoutesTo(slot: string, expected: string): boolean {
  let raw: string;
  try {
    raw = readlinkSync(slot);
  } catch {
    return false;
  }
  const resolvedTarget = isAbsolute(raw) ? raw : resolve(dirname(slot), raw);
  if (resolvedTarget === expected) return true;
  try {
    return realpathSync(resolvedTarget) === realpathSync(expected);
  } catch {
    return false;
  }
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
 * canonical symlinks whose link target routes back to this CLI's source
 * directory. `.agents/skills/` is a namespace shared with every other
 * politty-based CLI, so a dangling canonical symlink without a routing
 * match likely belongs to a foreign CLI whose source was uninstalled —
 * including it would let `sync` unlink it under our authority.
 */
function findOwnedInstalledSkills(
  expectedOwnership: string,
  cwd: string,
  sourceDir: string,
): string[] {
  const base = resolve(cwd, AGENTS_SKILLS_DIR);
  const owned: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT/ENOTDIR mean the install root doesn't exist yet — that's a
    // legitimate "no installed skills" state. Any other failure (EACCES,
    // EPERM, IO) means the directory exists but we can't read it; treating
    // that as "no installed skills" would silently skip orphan
    // reconciliation and `--exclude` validation, so warn instead.
    if (code === "ENOENT" || code === "ENOTDIR") return owned;
    logger.warn(`Failed to enumerate ${base}: ${err instanceof Error ? err.message : String(err)}`);
    return owned;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    // Legacy installs or other tools can leave spec-incompatible names in
    // this directory; `readInstalledOwnership()` throws via `assertSafeName`
    // on those. We want to silently skip those (they can't be owned by this
    // CLI), but surface real IO failures (EACCES/EPERM/etc) instead of
    // letting an unreadable orphan slip past `sync` without a trace.
    // Pre-screen with the same spec-compliant pattern as `assertSafeName`
    // (defense-in-depth duplicate, deliberately not a shared import) so
    // the catch path is reserved for IO errors.
    if (entry.name.length < 1 || entry.name.length > 64) continue;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.name)) continue;
    let owner: string | null;
    try {
      owner = readInstalledOwnership(entry.name, cwd);
    } catch (err) {
      logger.warn(
        `Failed to read ownership for ${entry.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (owner === expectedOwnership) {
      owned.push(entry.name);
      continue;
    }
    // Owner is unreadable. Only treat it as our orphan when the dangling
    // canonical symlink still points at this CLI's source directory; a
    // foreign politty-based CLI's stale install in the same namespace is
    // not ours to reap.
    const canonical = resolve(base, entry.name);
    if (
      owner === null &&
      isDanglingSymlink(canonical) &&
      danglingRoutesToSource(canonical, sourceDir)
    ) {
      owned.push(entry.name);
    }
  }
  return owned;
}
