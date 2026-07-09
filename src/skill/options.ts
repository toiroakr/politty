import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { UnknownKeysMode } from "../core/schema-extractor.js";
import { extractFields } from "../core/schema-extractor.js";
import type { ArgsSchema } from "../types.js";
import type { InstallMode, SkillCommandOptions } from "./types.js";

/** Default unknown-keys mode for the `add`/`sync`/`remove`/`list` arg schemas. */
const DEFAULT_UNKNOWN_KEYS: UnknownKeysMode = "strip";

/** Default short alias for `skills sync --exclude`. */
const DEFAULT_EXCLUDE_ALIAS = "x";

/** Default short alias for `skills add`/`skills sync --verbose`. */
const DEFAULT_VERBOSE_ALIAS = "v";

/** Default primary name + aliases for `skills add`. */
const DEFAULT_ADD_NAMES = ["add", "install"];

/** Default primary name + aliases for `skills remove`. */
const DEFAULT_REMOVE_NAMES = ["remove", "uninstall"];

/**
 * Same safe-token pattern politty's own command validator enforces for
 * subcommand aliases (`checkSubCommandAliasConflicts` in
 * src/validator/command-validator.ts). That check only runs when a host
 * explicitly calls `validateCommand()`, not automatically from
 * `runMain`/`runCommand`, so `commandMap` entries need their own check.
 */
const SAFE_TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

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
  /**
   * `--verbose` flag shared by `skills add`/`skills sync`. `disabled: true`
   * means the local schema no longer declares the flag at all — always the
   * case when `globalArgs` already defines a same-named `verbose` field
   * (see {@link SkillCommandOptions.globalArgs} for why keeping both a
   * local and same-named global field doesn't reliably work); there is no
   * manual override. `alias: undefined` means no short alias is registered
   * (but the long flag still exists, unless `disabled`).
   */
  verbose: { alias: string | undefined; disabled: boolean };
  /**
   * `--json` flag on `skills list`. `disabled: true` whenever `globalArgs`
   * already defines a `json` field; no manual override.
   */
  json: { disabled: boolean };
  /**
   * Primary (dispatched) name + aliases for `skills add`/`skills remove`.
   * Defaults to `add`/`install` and `remove`/`uninstall`; overridden via
   * `SkillCommandOptions.commandMap`.
   */
  commandNames: {
    add: { name: string; aliases: string[] };
    remove: { name: string; aliases: string[] };
  };
  /**
   * Unknown-keys handling applied uniformly to `add`/`sync`/`remove`/`list`.
   * Default `"strip"`. Governs only flags the parser cannot attribute to
   * this subcommand's own schema or the host's `globalArgs` schema — a
   * `globalArgs`-sourced value is never subject to this check (see
   * {@link SkillCommandOptions.unknownKeys}).
   */
  unknownKeys: UnknownKeysMode;
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
 * - `verbose` — alias `"v"` unless overridden via `flags.verbose.alias`;
 *   the flag itself is omitted from `add`/`sync` whenever `globalArgs`
 *   already defines a `verbose` field.
 * - `json` — the flag is omitted from `list` whenever `globalArgs` already
 *   defines a `json` field.
 * - `commandNames.add`/`.remove` — primary name `"add"`/`"remove"` plus
 *   alias `"install"`/`"uninstall"` unless overridden via
 *   `options.commandMap.add`/`.remove` (first array element becomes the
 *   primary name, the rest become aliases).
 * - `unknownKeys` — `"strip"` unless overridden via `options.unknownKeys`.
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
    verbose: resolveVerbose(options.flags?.verbose, options.globalArgs),
    json: { disabled: hasGlobalField(options.globalArgs, "json") },
    commandNames: {
      add: resolveCommandNaming(options.commandMap?.add, DEFAULT_ADD_NAMES, "add"),
      remove: resolveCommandNaming(options.commandMap?.remove, DEFAULT_REMOVE_NAMES, "remove"),
    },
    unknownKeys: options.unknownKeys ?? DEFAULT_UNKNOWN_KEYS,
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

/**
 * The first element of `value` (or `defaults`, when `value` is `undefined`)
 * becomes the primary name; the rest become aliases.
 */
function resolveCommandNaming(
  value: string[] | undefined,
  defaults: string[],
  label: string,
): { name: string; aliases: string[] } {
  const names = value ?? defaults;
  if (names.length === 0) {
    throw new Error(`SkillCommandOptions.commandMap.${label} must include at least one name.`);
  }
  const invalid = names.find((name) => !SAFE_TOKEN.test(name));
  if (invalid !== undefined) {
    throw new Error(
      `SkillCommandOptions.commandMap.${label} contains an invalid entry ${JSON.stringify(invalid)}. ` +
        `Names/aliases must start with an alphanumeric character and contain only alphanumeric ` +
        `characters, hyphens, or underscores.`,
    );
  }
  return { name: names[0]!, aliases: names.slice(1) };
}

function resolveVerbose(
  value: { alias?: string | false } | undefined,
  globalArgs: ArgsSchema | undefined,
): {
  alias: string | undefined;
  disabled: boolean;
} {
  const alias = value?.alias === false ? undefined : (value?.alias ?? DEFAULT_VERBOSE_ALIAS);
  return { alias, disabled: hasGlobalField(globalArgs, "verbose") };
}

/**
 * Does `globalArgs` (the host's `runMain`/`runCommand` global args schema,
 * if passed through `SkillCommandOptions.globalArgs`) already declare a
 * *non-positional boolean* field with this name? Determines whether the
 * matching built-in local flag (`verbose`/`json`) is omitted — see
 * {@link SkillCommandOptions.globalArgs}. Positional fields are excluded: a
 * positional named `verbose`/`json` has no `--verbose`/`--json` flag syntax
 * at all, so it can't actually collide with one. Non-boolean fields are
 * excluded too: `mergedFlag` boolean-coerces whatever value flows through,
 * and a same-named string/number field (e.g. a verbosity level or enum)
 * isn't really the same flag — coercing it (e.g. `Boolean("off")` is `true`)
 * would silently misread it, so it's not treated as a collision here and
 * the local boolean flag stays declared.
 *
 * Note: politty itself independently rejects this same situation. When
 * `globalArgs` and a command's own schema both declare a same-named field
 * with different definitions (as happens here — global non-boolean vs.
 * local boolean), `runMain`/`runCommand` throws `FieldTypeConflictError` at
 * parse time, regardless of what this function decides. This function
 * keeping the local flag "declared" doesn't make the combination usable —
 * it just means the failure surfaces as politty's own clear error instead
 * of a silent boolean-coercion misread. {@link SkillFlagOverrides.verbose}'s
 * `alias` option can't help either, since it only renames the short alias,
 * not the conflicting long field name. A host whose `globalArgs` defines a
 * non-boolean `verbose`/`json` field must rename or remove that global
 * field (or make it a plain boolean) instead.
 */
function hasGlobalField(globalArgs: ArgsSchema | undefined, name: string): boolean {
  if (!globalArgs) return false;
  return extractFields(globalArgs).fields.some(
    (field) => field.name === name && !field.positional && field.type === "boolean",
  );
}

function resolveDescriptionAppend(
  value: string | false | undefined,
  cliName: string,
): string | false {
  if (value === false) return false;
  if (typeof value === "string") return value;
  return `Manage agent skills with \`${cliName} skills <add|sync|remove|list>\`.`;
}
