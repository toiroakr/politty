/**
 * Types for shell completion generation
 */

import type { DynamicCompletionResolver } from "../core/dynamic-completion-types.js";
import type { ResolvedExpandCandidate } from "../core/expand-completion-types.js";
import type { AnyCommand, ArgsSchema } from "../types.js";

/**
 * A single resolved entry in an "expand" lookup table.
 *
 * `key` is the tuple of `dependsOn` values that triggers this entry, in the
 * same order as the originating `dependsOn` array. `candidates` is the
 * (already deduplicated) list returned by the user's `enumerate` callback
 * for that combination.
 */
export interface ExpandTableEntry {
  readonly key: readonly string[];
  readonly candidates: readonly ResolvedExpandCandidate[];
}

/**
 * Supported shell types for completion
 */
export type ShellType = "bash" | "zsh" | "fish";

/**
 * Completion script generation mode.
 *
 * - `dispatcher`: small runtime script that resolves the executable visible on
 *   PATH at TAB time and delegates to its `__complete` command.
 * - `static`: self-contained script with command metadata baked in at
 *   generation time.
 */
export type CompletionMode = "dispatcher" | "static";

/**
 * Optional published worker artifact lookup.
 *
 * Paths are resolved relative to the visible executable's real directory.
 * Templates may include `{shell}`, `{ext}`, and `{program}`.
 */
export interface BundledWorkerOptions {
  /** Disable bundled-worker lookup while keeping cache/dynamic fallbacks. */
  disabled?: boolean | undefined;
  /** Shell-specific worker paths relative to the executable directory. */
  relativePaths?: Partial<Record<ShellType, readonly string[]>> | undefined;
  /**
   * Let dispatcher scripts ask the CLI for `__completion-worker-path <shell>`
   * when package-relative lookup misses. Disabled by default because it starts
   * the CLI process on that miss path.
   */
  queryCommand?: boolean | undefined;
}

/**
 * Options for completion generation
 */
export interface CompletionOptions {
  /** The shell type to generate completion for */
  shell: ShellType;
  /** The command name as it will be invoked */
  programName: string;
  /** Include subcommand completions (default: true) */
  includeSubcommands?: boolean;
  /** Include description in completions where supported (default: true) */
  includeDescriptions?: boolean;
  /**
   * Completion script mode.
   *
   * `generateCompletion` defaults to `static` when this is omitted. The
   * `completion <shell>` subcommand passes `dispatcher` explicitly by default.
   */
  mode?: CompletionMode;
  /** Global args schema for deriving global options in completion */
  globalArgsSchema?: ArgsSchema;
  /**
   * Path to the binary whose mtime is the freshness signature.
   * Defaults to `process.argv[1]`.
   */
  binPath?: string;
  /** Program version to embed in the script header. */
  programVersion?: string;
  /**
   * Cache directory for the loader to write the regenerated script into.
   * Defaults to `${XDG_CACHE_HOME:-$HOME/.cache}/<programName>` at runtime.
   * Setting this hardcodes the location into the generated loader.
   */
  cacheDir?: string;
  /**
   * Internal static-worker generation hook used by dispatcher caches.
   * Worker scripts define suffixed functions and skip shell registration.
   */
  staticWorker?: { functionSuffix: string };
  /** Published static-worker artifact lookup used by dispatcher mode. */
  bundledWorker?: BundledWorkerOptions | undefined;
}

/**
 * Value completion specification for shell scripts.
 *
 * Discriminated by `type`. The `dynamic` variant carries a JS resolver that
 * the static shell scripts delegate to via `<program> __complete`. All
 * variants share the same optional metadata fields (left undefined where
 * inapplicable) so consumers can read `vc.choices`/`vc.extensions`/etc.
 * without narrowing first.
 */
export type ValueCompletion =
  | ({
      /** Completion type */
      type: "choices" | "file" | "directory" | "command" | "none";
      /** List of valid choices (for "choices" type) */
      choices?: string[];
      /** Shell command for dynamic completion (for "command" type) */
      shellCommand?: string;
      resolve?: never;
      dependsOn?: never;
      table?: never;
    } & (
      | { /** File extension filters (for "file" type) */ extensions?: string[]; matcher?: never }
      | {
          /** Glob patterns for file matching (for "file" type) */ matcher?: string[];
          extensions?: never;
        }
    ))
  | {
      /** In-process dynamic completion via JS callback. */
      type: "dynamic";
      resolve: DynamicCompletionResolver;
      choices?: never;
      shellCommand?: never;
      extensions?: never;
      matcher?: never;
      dependsOn?: never;
      table?: never;
    }
  | {
      /**
       * Pre-enumerated completion baked into the generated shell script.
       * The `table` is the cartesian product of the `dependsOn` arg values
       * (each having a static `choices` or enum schema). At completion time
       * the shell dispatches on the runtime values of those args — no Node
       * is spawned.
       */
      type: "expand";
      dependsOn: readonly string[];
      table: readonly ExpandTableEntry[];
      choices?: never;
      shellCommand?: never;
      resolve?: never;
      extensions?: never;
      matcher?: never;
    }
  | {
      /**
       * Runtime form of `completion.custom.expand` used by `__complete`.
       * The dispatcher invokes `__complete` at TAB time, so it can call the
       * user's `enumerate` function against the already typed dependency
       * values instead of baking a table into the shell script.
       */
      type: "runtime-expand";
      dependsOn: readonly string[];
      enumerate: (
        deps: Readonly<Record<string, string>>,
      ) => ReadonlyArray<string | { value: string; description?: string }>;
      choices?: never;
      shellCommand?: never;
      resolve?: never;
      extensions?: never;
      matcher?: never;
      table?: never;
    };

/**
 * Information about a completable option
 */
export interface CompletableOption {
  /** Long option name (e.g., "verbose") */
  name: string;
  /** CLI name (kebab-case, e.g., "dry-run") */
  cliName: string;
  /**
   * Aliases for this option (both short and long).
   * 1-char entries are short (`-v`); multi-char entries are long (`--to-be`).
   */
  alias?: string[] | undefined;
  /**
   * Negation name to advertise in shell completions (no `--` prefix),
   * or `undefined` to hide the negation. Mirrors `ResolvedFieldMeta.negationDisplay`.
   */
  negation?: string | undefined;
  /** Description for the negation option (when distinct from the main description) */
  negationDescription?: string | undefined;
  /**
   * Whether the runtime parser accepts the default `--no-<cliName>` (and
   * camelCase) form for this boolean option. True only when the user set
   * `negation: true`; false when unset, `negation: false`, or
   * `negation: <custom name>`. Used by the completion context parser so
   * dynamic resolvers see the same `parsedArgs` state the runtime would compute.
   */
  defaultNegationAccepted?: boolean;
  /** Description for completion */
  description?: string | undefined;
  /**
   * True when this option originates from a `globalArgsSchema` and was
   * propagated into every subcommand frame. The runtime parser keeps
   * global values visible across subcommand descent, so shell generators
   * must keep their tracker buckets separate from per-frame state.
   */
  isGlobal?: boolean;
  /** Whether this option takes a value */
  takesValue: boolean;
  /** Type of value expected */
  valueType: "string" | "number" | "boolean" | "array" | "unknown";
  /** Whether the option is required */
  required: boolean;
  /** Value completion specification */
  valueCompletion?: ValueCompletion | undefined;
}

/**
 * Information about a positional argument for completion
 */
export interface CompletablePositional {
  /** Field name */
  name: string;
  /** CLI name (kebab-case) */
  cliName: string;
  /** Position index (0-based) */
  position: number;
  /** Description */
  description?: string | undefined;
  /** Whether required */
  required: boolean;
  /** Whether this positional accepts multiple values (array type) */
  variadic?: boolean | undefined;
  /** Value completion specification */
  valueCompletion?: ValueCompletion | undefined;
}

/**
 * Information about a subcommand for completion
 */
export interface CompletableSubcommand {
  /** Subcommand name */
  name: string;
  /** Subcommand description */
  description?: string | undefined;
  /** Alternative names (aliases) for this subcommand */
  aliases?: string[] | undefined;
  /** Nested subcommands */
  subcommands: CompletableSubcommand[];
  /** Options for this subcommand */
  options: CompletableOption[];
  /** Positional arguments */
  positionals: CompletablePositional[];
}

/**
 * Extracted completion data from a command
 */
export interface CompletionData {
  /** The root command */
  command: CompletableSubcommand;
  /** Program name */
  programName: string;
  /** Global options (available to all subcommands) */
  globalOptions: CompletableOption[];
}

/**
 * Result of completion generation
 */
export interface CompletionResult {
  /** The generated completion script */
  script: string;
  /** The shell type this script is for */
  shell: ShellType;
  /** Instructions for installing the completion */
  installInstructions: string;
}

/**
 * Generator function type for shell completions
 */
export type CompletionGenerator = (
  command: AnyCommand,
  options: CompletionOptions,
) => CompletionResult;
