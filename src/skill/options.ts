import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { InstallMode, SkillCommandOptions } from "./types.js";

/** Default short alias for `skills sync --exclude`. */
const DEFAULT_EXCLUDE_ALIAS = "x";

/** Marker files identifying a project root for find-up. */
const PROJECT_ROOT_MARKERS = [".git", "package.json"] as const;

/**
 * Fully-resolved {@link SkillCommandOptions} with all defaults applied.
 *
 * Computed once per `withSkillCommand` call so every subcommand observes
 * the same install root, alias choice, and description rendering.
 */
export interface ResolvedSkillOptions {
  sourceDir: string;
  package: string;
  mode: InstallMode | undefined;
  cwd: string;
  /** `undefined` means no short alias is registered. */
  excludeAlias: string | undefined;
  /** Either the literal append string, or `false` to leave the description untouched. */
  descriptionAppend: string | false;
  /**
   * Ownership stamp `"{package}:{cliName}"` stored on installed skills and
   * checked before install/remove. Precomputed so subcommand factories
   * never see `cliName` directly.
   */
  stamp: string;
}

/**
 * Resolve user-facing {@link SkillCommandOptions} into the concrete shape
 * each subcommand consumes. Defaults applied here:
 *
 * - `cwd` — `findProjectRoot(process.cwd()) ?? process.cwd()`.
 * - `excludeAlias` — `"x"` unless overridden via
 *   `flags.exclude.alias` (string) or disabled (`false`).
 * - `descriptionAppend` — a one-line hint mentioning the skills
 *   subcommands. Pass an explicit string to override or `false` to opt out.
 */
export function resolveSkillOptions(
  options: SkillCommandOptions,
  cliName: string,
): ResolvedSkillOptions {
  return {
    sourceDir: options.sourceDir,
    package: options.package,
    mode: options.mode,
    cwd: resolveCwd(options.cwd),
    excludeAlias: resolveExcludeAlias(options.flags?.exclude?.alias),
    descriptionAppend: resolveDescriptionAppend(options.descriptionAppend, cliName),
    stamp: `${options.package}:${cliName}`,
  };
}

function resolveCwd(override: string | undefined): string {
  if (override !== undefined) return resolve(override);
  const start = process.cwd();
  return findProjectRoot(start) ?? start;
}

/**
 * Walk up from `start` looking for the closest directory containing one
 * of {@link PROJECT_ROOT_MARKERS}. Returns `null` when the walk reaches
 * the filesystem root without a hit.
 *
 * `.git` matches both repositories (a directory) and worktrees / submodule
 * checkouts (a file pointing at the parent gitdir) because `existsSync`
 * accepts either.
 */
export function findProjectRoot(start: string): string | null {
  let dir = resolve(start);
  while (true) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (existsSync(resolve(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveExcludeAlias(value: string | false | undefined): string | undefined {
  if (value === false) return undefined;
  if (typeof value === "string") return value;
  return DEFAULT_EXCLUDE_ALIAS;
}

function resolveDescriptionAppend(
  value: string | false | undefined,
  cliName: string,
): string | false {
  if (value === false) return false;
  if (typeof value === "string") return value;
  return `Manage agent skills with \`${cliName} skills <add|sync|remove|list>\`.`;
}
