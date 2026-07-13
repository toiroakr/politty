import type { z } from "zod";
import type { UnknownKeysMode } from "../core/schema-extractor.js";
import type { AnyCommand, ArgsSchema } from "../types.js";
import type { skillFrontmatterSchema } from "./frontmatter.js";

/**
 * SKILL.md frontmatter metadata, validated against the Agent Skills
 * specification (https://agentskills.io/specification).
 *
 * Provenance for politty-managed installs is recorded under
 * `metadata["politty-cli"]` as `"{packageName}:{cliName}"`.
 */
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

/**
 * A skill discovered from a source directory (npm package).
 */
export interface DiscoveredSkill {
  /** Parsed frontmatter metadata */
  frontmatter: SkillFrontmatter;
  /** Path to the directory containing SKILL.md */
  sourcePath: string;
  /** Raw SKILL.md content (frontmatter + body) */
  rawContent: string;
}

/**
 * All kinds of scan failure, as a runtime tuple so callers can exhaustively
 * iterate (e.g. for message tables). Derived {@link ScanErrorReason} stays
 * the single source of truth for the type-level enum.
 */
export const SCAN_ERROR_REASONS = [
  "parse-failed",
  "name-mismatch",
  "read-failed",
  "missing-source",
] as const;

/** Kind of problem encountered by {@link scanSourceDir}. */
export type ScanErrorReason = (typeof SCAN_ERROR_REASONS)[number];

/**
 * A non-fatal problem encountered while scanning a source directory.
 *
 * Scan errors (invalid frontmatter, name/parent-dir mismatch, unreadable
 * files) are collected rather than thrown so that a single malformed skill
 * does not hide the rest from CLI commands.
 */
export interface ScanError {
  /** Directory that produced the error. */
  path: string;
  /** Kind of problem encountered. */
  reason: ScanErrorReason;
  /** Human-readable detail, suitable for logging. */
  message: string;
  /**
   * Parsed frontmatter `name`, when the scan got far enough to read it.
   * Currently populated only for `name-mismatch` — both the directory
   * basename and this frontmatter name correspond to plausible existing
   * install slot names (depending on which side the user just renamed),
   * so `sync`'s orphan-retention guard needs both to avoid reaping an
   * installed slot belonging to a source skill that failed this scan.
   */
  skillName?: string;
}

/**
 * Result of scanning a source directory for SKILL.md files.
 */
export interface ScanResult {
  /** Valid, spec-compliant skills. */
  skills: DiscoveredSkill[];
  /** Directories that looked like skills but failed validation. */
  errors: ScanError[];
}

/**
 * How an install materializes skill files under `.agents/skills/<name>`
 * and each `SYMLINK_TARGETS` entry.
 *
 * - `"symlink"` (default): symlink the source into place. Source updates
 *   propagate live. Throws with guidance to retry with `"copy"` when
 *   `symlinkSync` fails (e.g. Windows without Developer Mode, filesystems
 *   that do not support symlinks).
 * - `"copy"`: recursive copy. Source updates require re-running `skills
 *   sync`. Works on any filesystem, trades liveness for portability.
 */
export type InstallMode = "symlink" | "copy";

/** Options for {@link installSkill}. */
export interface InstallSkillOptions {
  /** Install materialization strategy. Default: `"symlink"`. */
  mode?: InstallMode;
}

/** Options for {@link uninstallSkill}. */
export interface UninstallSkillOptions {
  /**
   * If set, `uninstallSkill` also removes a real directory at the install
   * path when its SKILL.md's `metadata["politty-cli"]` matches this stamp
   * (a copy-mode install this CLI owns). Without this option, only
   * symlinks are removed — real directories are assumed to be legacy or
   * manual installs and left untouched.
   */
  expectedOwnership?: string;
}

/**
 * Per-flag overrides for the built-in skill subcommand options.
 *
 * Pass through {@link SkillCommandOptions.flags} to resolve collisions with
 * CLI-level global flags. Setting `alias` to `false` disables the short
 * alias entirely; passing a string renames it.
 */
export interface SkillFlagOverrides {
  /**
   * `--exclude` flag on `skills sync`. The default short alias is `-x`.
   */
  exclude?: {
    alias?: string | false;
  };
  /**
   * `--verbose` flag shared by `skills add` and `skills sync`. The default
   * short alias is `-v`.
   *
   * This is independent of {@link SkillCommandOptions.globalArgs}'s
   * field-name auto-detection (which drops the flag entirely when the
   * host's `globalArgs` already defines a `verbose` field). `alias` instead
   * resolves a *short-alias-only* collision — e.g. the host's `globalArgs`
   * uses `-v` for an unrelated flag (not named `verbose`), so auto-detection
   * doesn't apply, but the single-character alias still collides.
   */
  verbose?: {
    alias?: string | false;
  };
}

/**
 * Options for `withSkillCommand`.
 */
export interface SkillCommandOptions {
  /**
   * Source directory containing SKILL.md files.
   *
   * Each subdirectory whose name matches its `SKILL.md` frontmatter `name`
   * is treated as a skill. Symlinks within the source tree are followed.
   *
   * @example
   * ```typescript
   * // Resolves to ../skills relative to the current file.
   * // Works from both src/ and dist/ if at the same depth.
   * const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), "../skills");
   * ```
   */
  sourceDir: string;

  /**
   * npm package name that owns this CLI's bundled skills.
   *
   * Each source `SKILL.md` must pre-declare
   * `metadata["politty-cli"]: "{package}:{cliName}"`. The `skills add` and
   * `skills sync` subcommands verify this stamp before installing — two
   * tools managing skills in the same project cannot accidentally clobber
   * each other. `installSkill` itself does not compare ownership;
   * programmatic callers that bypass `withSkillCommand` are responsible
   * for matching the stamp against their own `{package}:{cliName}` up
   * front. (In `mode: "copy"`, `installSkill` additionally requires
   * *some* `politty-cli` stamp on the source and throws otherwise — the
   * caller-side ownership check naturally satisfies that precondition.)
   */
  package: string;

  /**
   * Default install mode for the `skills add` and `skills sync` commands.
   * Defaults to `"symlink"` — install fails with a clear error on
   * filesystems without symlink support (e.g. Windows without Developer
   * Mode). Set to `"copy"` to always copy. See {@link InstallMode}.
   */
  mode?: InstallMode;

  /**
   * Project root directory used by every `skills` subcommand for resolving
   * `.agents/skills/...` install paths.
   *
   * Default: walk up from `process.cwd()` and use the first ancestor that
   * contains `.git/` or `package.json`; fall back to `process.cwd()` when
   * neither is found. This avoids creating `<sub>/.agents/skills/...` when
   * the CLI is invoked from a subdirectory of the project.
   *
   * Pass an explicit absolute (or cwd-relative) path to override — for
   * example, the directory of a CLI-specific config file.
   */
  cwd?: string;

  /**
   * The host CLI's global args schema — the same value passed to
   * `runMain`/`runCommand`'s `globalArgs` option.
   *
   * When provided, `skills add`/`skills sync`'s `--verbose` and `skills
   * list`'s `--json` are automatically omitted from their own schema if
   * this schema already defines a same-named *non-positional boolean*
   * field — no manual configuration needed, and the host's global flag of
   * the same name takes over instead.
   *
   * A same-named field of another type (e.g. a string verbosity level)
   * doesn't trigger this — the local boolean flag stays declared. However,
   * politty itself independently rejects that combination: when
   * `globalArgs` and a command's own schema declare a same-named field
   * with different definitions, `runMain`/`runCommand` throws
   * `FieldTypeConflictError` at parse time. {@link SkillFlagOverrides} can't
   * help here — it only renames the short alias (`-v`/`-x`), not the long
   * `--verbose`/`--json` field name itself, so the conflicting name stays
   * either way. A host whose `globalArgs` uses a non-boolean `verbose`/
   * `json` field must rename or remove that global field (or make it a
   * plain boolean) instead.
   *
   * (Historical note: this omission used to also be required to work around
   * a politty core bug where a global flag typed *before* the subcommand
   * resolved correctly as a global value, but a same-named local field's
   * own default would then overwrite it during the merge. That bug is
   * fixed in politty core independently of this option — a same-named
   * local and global field with *identical* definitions now resolves
   * correctly regardless of position. This option still omits the local
   * flag by default for simplicity: hosts don't need to duplicate the
   * flag's definition on both schemas to get the expected behavior.)
   *
   * @example
   * ```ts
   * const globalArgs = z.object({
   *   verbose: arg(z.boolean().default(false), { alias: "v" }),
   * });
   *
   * const cli = withSkillCommand(baseCommand, {
   *   sourceDir, package: "@my-agent/skills",
   *   globalArgs, // skills add/sync automatically drop their own --verbose
   * });
   *
   * runMain(cli, { globalArgs }); // same schema, passed to the real entry point
   * ```
   */
  globalArgs?: ArgsSchema;

  /**
   * Unknown-keys handling for the `add`/`sync`/`remove`/`list` arg schemas
   * (applied uniformly to all four).
   *
   * - `"strip"` (default) — matches politty's own `z.object()` default:
   *   an unrecognized flag prints a warning and its value is dropped from
   *   the parsed args.
   * - `"strict"` — an unrecognized flag is a hard error, matching a host
   *   CLI that uses `z.strictObject()`/`.strict()` throughout.
   * - `"passthrough"` — matches `z.object().passthrough()`: no warning,
   *   and unlike `"strip"`, the unrecognized flag's value is *kept* on the
   *   parsed args object under its raw CLI name (e.g. `args["some-flag"]`)
   *   rather than dropped.
   *
   * This only governs flags the parser cannot attribute to *either* this
   * subcommand's own schema or the host's `globalArgs` schema — a value
   * that legitimately arrives via `globalArgs` (see
   * {@link SkillCommandOptions.globalArgs}) is validated separately against
   * that schema and merged in afterward, so it is never rejected here.
   */
  unknownKeys?: UnknownKeysMode;

  /**
   * Customize built-in subcommand flags. Use to resolve collisions with
   * the CLI's global flags or to opt out of short aliases.
   *
   * @example
   * ```ts
   * // CLI already uses -x globally; rename the exclude alias.
   * withSkillCommand(cmd, {
   *   sourceDir, package: "@my-agent/skills",
   *   flags: { exclude: { alias: "X" } },
   * });
   *
   * // Disable the short alias entirely.
   * withSkillCommand(cmd, {
   *   sourceDir, package: "@my-agent/skills",
   *   flags: { exclude: { alias: false } },
   * });
   * ```
   */
  flags?: SkillFlagOverrides;

  /**
   * Append a one-line skills usage hint to the wrapped command's
   * `description` so `--help` advertises the skills subcommand.
   *
   * - `undefined` (default) — append a default hint mentioning the
   *   available subcommands.
   * - `string` — append this exact string instead.
   * - `false` — leave the description untouched.
   */
  descriptionAppend?: string | false;

  /**
   * Override the primary (dispatched) name and aliases of `skills add` and
   * `skills remove`. In each array, the *first* element becomes the
   * subcommand's primary name; every element after it becomes an alias.
   *
   * Default: `add: ["add", "install"]`, `remove: ["remove", "uninstall"]`.
   *
   * Useful when a host CLI wants to rename these subcommands outright, drop
   * the `install`/`uninstall` backward-compatibility aliases, add further
   * aliases, or some combination of all three.
   *
   * @example
   * ```ts
   * withSkillCommand(cmd, {
   *   sourceDir, package: "@my-agent/skills",
   *   commandMap: {
   *     add: ["setup", "add", "install"], // renamed to "setup"; "add"/"install" still work
   *     remove: ["remove"], // no aliases at all
   *   },
   * });
   * ```
   */
  commandMap?: {
    /** Primary name + aliases for `skills add`. Default: `["add", "install"]`. */
    add?: string[];
    /** Primary name + aliases for `skills remove`. Default: `["remove", "uninstall"]`. */
    remove?: string[];
  };

  /**
   * Override the description text for the `skills` command and/or its
   * built-in subcommands. Any key left unset keeps politty's default
   * description for that command.
   *
   * Keys refer to the subcommand's *canonical role*, not its dispatched
   * name — e.g. `descriptions.add` still applies after `commandMap.add`
   * renames the subcommand to something else.
   *
   * @example
   * ```ts
   * withSkillCommand(cmd, {
   *   sourceDir, package: "@my-agent/skills",
   *   commandMap: { add: ["setup", "add", "install"] },
   *   descriptions: {
   *     skills: "Manage My Agent skills",
   *     add: "Install My Agent skills", // still keyed by "add", not "setup"
   *   },
   * });
   * ```
   */
  descriptions?: {
    /** Description for the top-level `skills` command. Default: `"Manage agent skills"`. */
    skills?: string;
    /** Description for `skills sync`. Default: `"Remove and reinstall all skills from source"`. */
    sync?: string;
    /** Description for `skills add`. Default: `"Install skills from source"`. */
    add?: string;
    /** Description for `skills remove`. Default: `"Remove installed skills"`. */
    remove?: string;
    /** Description for `skills list`. Default: `"List available skills from source"`. */
    list?: string;
  };
}

/**
 * Result of wrapping `T` with {@link withSkillCommand} — `T` with a
 * `skills` entry added to (and required on) `subCommands`, so consumers can
 * access `command.subCommands.skills` without an `as AnyCommand` cast.
 */
export type WithSkillCommand<T extends AnyCommand> = T & {
  subCommands: NonNullable<T["subCommands"]> & { skills: AnyCommand };
};
