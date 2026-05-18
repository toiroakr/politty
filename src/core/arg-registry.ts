import { z } from "zod";

import type { GlobalArgs, IsEmpty } from "../types.js";
import type { DynamicCompletionResolver } from "./dynamic-completion-types.js";

/**
 * Built-in completion types
 */
export type CompletionType = "file" | "directory" | "none";

/**
 * Custom completion specification.
 *
 * `choices`, `shellCommand`, and `resolve` are mutually exclusive — specifying
 * more than one throws when the field metadata is resolved.
 */
export interface CustomCompletion {
  /** Static list of choices for completion */
  choices?: string[];
  /** Shell command to execute for dynamic completion */
  shellCommand?: string;
  /**
   * In-process JS callback for dynamic completion. Receives parsed context
   * (other arg values typed so far, previously supplied values for this same
   * option) and returns candidates. Static shell scripts delegate to
   * `<program> __complete` whenever this is set.
   */
  resolve?: DynamicCompletionResolver;
}

/**
 * Completion metadata for an argument
 *
 * @example
 * ```ts
 * // File completion with extension filter
 * input: arg(z.string(), {
 *   completion: { type: "file", extensions: ["json", "yaml"] }
 * })
 *
 * // Directory completion
 * outputDir: arg(z.string(), {
 *   completion: { type: "directory" }
 * })
 *
 * // Custom static choices
 * logLevel: arg(z.string(), {
 *   completion: { custom: { choices: ["debug", "info", "warn", "error"] } }
 * })
 *
 * // Dynamic completion from shell command
 * branch: arg(z.string(), {
 *   completion: { custom: { shellCommand: "git branch --format='%(refname:short)'" } }
 * })
 *
 * // File completion with glob pattern matcher
 * envFile: arg(z.string(), {
 *   completion: { type: "file", matcher: [".env.*"] }
 * })
 * ```
 */
export type CompletionMeta = {
  /** Built-in completion type */
  type?: CompletionType;
  /** Custom completion (takes precedence over type if both specified) */
  custom?: CustomCompletion;
} & (
  | {
      /** File extension filter (only applies when type is "file") */ extensions?: string[];
      matcher?: never;
    }
  | {
      /** Glob patterns for file matching (only applies when type is "file") */ matcher?: string[];
      extensions?: never;
    }
);

/**
 * Prompt input type for interactive prompts
 *
 * - "text": free-form text input (default for string schemas)
 * - "password": masked text input
 * - "confirm": yes/no prompt (default for boolean schemas)
 * - "select": single selection from choices (default for enum schemas)
 * - "file": file path input (inherited from completion type)
 * - "directory": directory path input (inherited from completion type)
 */
export type PromptType = "text" | "password" | "confirm" | "select" | "file" | "directory";

/**
 * Prompt metadata for interactive input when a value is missing.
 * Used by the `politty/prompt` module to request user input for unresolved arguments.
 *
 * @example
 * ```ts
 * // Custom prompt message
 * name: arg(z.string(), {
 *   prompt: { message: "What is your name?" }
 * })
 *
 * // Password input (masked)
 * token: arg(z.string(), {
 *   prompt: { type: "password", message: "Enter API token" }
 * })
 *
 * // Select with custom choices
 * region: arg(z.string(), {
 *   prompt: { choices: ["us-east-1", "eu-west-1", "ap-northeast-1"] }
 * })
 * ```
 */
export interface PromptMeta {
  /** Prompt message shown to the user. Defaults to the field's description or name. */
  message?: string;
  /** Explicit prompt type. Overrides auto-detection from schema/completion. */
  type?: PromptType;
  /** Choices for select prompt. Overrides enum values from schema. */
  choices?: Array<string | { label: string; value: string }>;
  /** Whether to enable prompting for this field (default: true when prompt is set) */
  enabled?: boolean;
}

/**
 * Context provided to effect callbacks.
 * When GlobalArgs is extended via declaration merging, `globalArgs` is typed accordingly.
 */
export type EffectContext = {
  /** Field name (camelCase) */
  name: string;
  /** Validated args for this schema (global args for global effects, command args for command effects) */
  args: Readonly<Record<string, unknown>>;
} & (IsEmpty<GlobalArgs> extends true
  ? { globalArgs?: Readonly<Record<string, unknown>> }
  : { globalArgs?: Readonly<GlobalArgs> });

/**
 * Base metadata shared by all argument types
 */
export interface BaseArgMeta<TValue = unknown> {
  /** Argument description */
  description?: string;
  /** Treat as positional argument */
  positional?: boolean;
  /** Placeholder for help display */
  placeholder?: string;
  /**
   * Environment variable name(s) to read value from.
   * If an array is provided, earlier entries take priority.
   * CLI arguments always take precedence over environment variables.
   *
   * @example
   * ```ts
   * // Single env var
   * port: arg(z.coerce.number(), { env: "PORT" })
   *
   * // Multiple env vars (PORT takes priority over SERVER_PORT)
   * port: arg(z.coerce.number(), { env: ["PORT", "SERVER_PORT"] })
   * ```
   */
  env?: string | string[];
  /** Completion configuration for shell tab-completion */
  completion?: CompletionMeta;
  /**
   * Interactive prompt configuration for missing values.
   * When set, the `politty/prompt` module will prompt the user interactively
   * if this argument is not provided via CLI args or environment variables.
   *
   * @example
   * ```ts
   * name: arg(z.string(), {
   *   description: "User name",
   *   prompt: { message: "What is your name?" },
   * })
   * ```
   */
  prompt?: PromptMeta;
  /**
   * Control the boolean negation option.
   *
   * Boolean fields automatically accept `--no-<cliName>` (and the camelCase
   * `--no<Name>` form) to set the value to `false`. By default this form is
   * accepted by the parser but hidden from help, generated docs, and shell
   * completions. This option lets you customize or expose that behavior:
   *
   * - `string` — replaces the auto-generated `--no-*` form with a custom
   *   name. The default `--no-*` is no longer recognized.
   * - `true`  — opt-in to advertising the default `--no-<cliName>` form in
   *   help, generated docs, and shell completions. Parser behavior is
   *   unchanged.
   * - `false` — disables negation entirely; neither the default `--no-*`
   *   nor any custom name is accepted.
   *
   * String values follow the same naming conventions as `cliName`
   * (kebab-case is recommended). Only valid on boolean fields; setting
   * `negation` on a non-boolean field is a type error and raises a
   * runtime error during command parsing.
   *
   * @example
   * ```ts
   * // Custom negation name
   * cache: arg(z.boolean().default(true), {
   *   description: "Enable caching",
   *   negation: "disable-cache",
   * })
   * // Accepts: --cache (true), --disable-cache (false)
   * // No longer accepts: --no-cache
   *
   * // Expose default `--no-X` in help/docs/completion
   * verbose: arg(z.boolean().default(false), {
   *   negation: true,
   * })
   * // Help shows `--verbose / --no-verbose`
   *
   * // Disable negation entirely
   * dryRun: arg(z.boolean().default(false), {
   *   negation: false,
   * })
   * // Accepts: --dry-run (true)
   * // No longer accepts: --no-dry-run
   * ```
   */
  negation?: string | boolean;
  /**
   * Description shown for the negation option in help and generated docs.
   * Only meaningful when `negation` is set to a custom name string or `true`.
   * Disallowed when `negation` is `false`.
   */
  negationDescription?: string;
  /**
   * Side-effect callback executed after argument parsing and validation.
   * Runs before the command lifecycle (setup/run/cleanup).
   * Use Zod .transform() for value transformation instead.
   *
   * @example
   * ```ts
   * verbose: arg(z.boolean().default(false), {
   *   alias: "v",
   *   effect: (value) => {
   *     if (value) logger.setLevel("debug");
   *   },
   * })
   * ```
   */
  effect?: (value: TValue, context: EffectContext) => void | PromiseLike<void>;
}

/**
 * Metadata for regular arguments (non-builtin aliases)
 *
 * `alias` accepts either a single string or an array of strings.
 * Single-character entries become short options (e.g. `-v`); multi-character
 * entries become additional long options (e.g. `--to-be` for `--tobe`).
 */
export interface RegularArgMeta<TValue = unknown> extends BaseArgMeta<TValue> {
  /**
   * Alias name(s) for this option.
   * - 1-char string  → short alias (`-v`)
   * - >1-char string → long alias (`--long-name`)
   * - array          → multiple aliases of either kind
   */
  alias?: string | string[] | readonly string[];
  /**
   * Alias name(s) that are accepted by the parser but hidden from help,
   * generated docs, and shell completion. Useful for legacy or deprecated
   * names that should still work without being advertised.
   */
  hiddenAlias?: string | string[] | readonly string[];
}

/**
 * Metadata for overriding built-in aliases (-h, -H)
 */
export interface BuiltinOverrideArgMeta<TValue = unknown> extends BaseArgMeta<TValue> {
  /** Built-in alias to override ('h' or 'H'), optionally combined with extra aliases */
  alias: "h" | "H" | Array<"h" | "H" | string> | ReadonlyArray<"h" | "H" | string>;
  /** Hidden aliases (accepted but not surfaced in help/docs/completion) */
  hiddenAlias?: string | string[] | readonly string[];
  /** Must be true to override built-in aliases */
  overrideBuiltinAlias: true;
}

/**
 * Metadata options for argument definition
 */
export type ArgMeta<TValue = unknown> = RegularArgMeta<TValue> | BuiltinOverrideArgMeta<TValue>;

/**
 * Custom registry for politty argument metadata
 * This avoids polluting Zod's GlobalMeta
 */
export const argRegistry = z.registry<ArgMeta>();

/**
 * Register metadata for a Zod schema
 *
 * @param schema - The Zod schema
 * @param meta - Argument metadata
 * @returns The same schema (for chaining)
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { arg, defineCommand } from "politty";
 *
 * const cmd = defineCommand({
 *   args: z.object({
 *     name: arg(z.string(), { description: "User name", positional: true }),
 *     verbose: arg(z.boolean().default(false), { alias: "v" }),
 *   }),
 *   run: (args) => {
 *     console.log(args.name, args.verbose);
 *   },
 * });
 * ```
 */
/**
 * Detect whether `A` contains a reserved alias ("h" or "H"), for either a
 * plain string or a tuple/array of strings. Uses `[A] extends [never]` to
 * prevent distribution returning `never` for missing fields.
 */
type ContainsReservedAlias<A> = [A] extends [never]
  ? false
  : A extends "h" | "H"
    ? true
    : A extends readonly (infer E)[]
      ? [Extract<E, "h" | "H">] extends [never]
        ? false
        : true
      : false;

type ReservedAliasTypeError<M> = {
  [K in keyof M]: M[K];
} & {
  __typeError: "Alias 'h' or 'H' requires overrideBuiltinAlias: true";
};

type NegationTypeError<M> = {
  [K in keyof M]: M[K];
} & {
  __typeError: "negation/negationDescription can only be used on boolean fields";
};

type AliasFieldOf<M> = M extends { alias: infer A } ? A : never;
type HiddenAliasFieldOf<M> = M extends { hiddenAlias: infer H } ? H : never;

/**
 * Check whether a Zod output type is a (possibly optional) boolean.
 * Strips `undefined` to allow `z.boolean().optional()`. Requires both
 * `boolean extends NonNullable<T>` (so `z.literal(true)` is rejected — the full
 * `boolean` domain is needed) and `NonNullable<T> extends boolean` (so unions
 * such as `z.union([z.boolean(), z.string()])` are rejected at the type level
 * to match the runtime check).
 */
type IsBooleanField<T> =
  boolean extends NonNullable<T> ? ([NonNullable<T>] extends [boolean] ? true : false) : false;

/**
 * Detect whether `M` has `K` set to a non-undefined value.
 *
 * When `M` is inferred from a literal such as `{ negation: "off" }`,
 * `M["negation"]` is `"off"` (without `undefined`), so this returns `true`.
 * When `M` is the wider `ArgMeta` type, `M["negation"]` is
 * `string | boolean | undefined`, so this returns `false` and avoids
 * false-positive type errors on broadly-typed meta values.
 */
type HasExplicit<M, K extends string> = K extends keyof M
  ? undefined extends M[K]
    ? false
    : true
  : false;

/**
 * Reject `negation` / `negationDescription` on non-boolean fields.
 * Uses {@link HasExplicit} so the error only fires when the user explicitly
 * sets the field on a narrowly-inferred meta literal.
 */
type ValidateNegation<M, TValue> =
  HasExplicit<M, "negation"> extends true
    ? IsBooleanField<TValue> extends true
      ? M
      : NegationTypeError<M>
    : HasExplicit<M, "negationDescription"> extends true
      ? IsBooleanField<TValue> extends true
        ? M
        : NegationTypeError<M>
      : M;

/**
 * Type helper to validate ArgMeta.
 * Forces a type error when a reserved alias ("h" / "H") is used without
 * `overrideBuiltinAlias: true`, whether the alias is provided as a string
 * or as part of an array, and whether it appears in `alias` or `hiddenAlias`.
 * Also rejects `negation` / `negationDescription` on non-boolean fields.
 */
type ValidateArgMeta<M, TValue = unknown> = M extends { overrideBuiltinAlias: true }
  ? ValidateNegation<M, TValue>
  : ContainsReservedAlias<AliasFieldOf<M>> extends true
    ? ReservedAliasTypeError<M>
    : ContainsReservedAlias<HiddenAliasFieldOf<M>> extends true
      ? ReservedAliasTypeError<M>
      : ValidateNegation<M, TValue>;

export function arg<T extends z.ZodType>(schema: T): T;
export function arg<T extends z.ZodType, M extends ArgMeta<z.output<T>>>(
  schema: T,
  meta: ValidateArgMeta<M, z.output<T>>,
): T;
export function arg<T extends z.ZodType>(
  schema: T,
  meta?: ValidateArgMeta<ArgMeta, z.output<T>>,
): T {
  if (meta) {
    argRegistry.add(schema, meta as ArgMeta);
  }
  return schema;
}

/**
 * Get metadata for a schema from the registry
 *
 * @param schema - The Zod schema
 * @returns The metadata if registered, undefined otherwise
 */
export function getArgMeta(schema: z.ZodType): ArgMeta | undefined {
  // Zod's `$replace<Meta, S>` recursively rewrites the meta type, which mangles
  // the generic `then` signature of `PromiseLike<void>` inside `effect`'s return
  // type under newer TypeScript builds (@typescript/native-preview ≥ 20260504).
  // The runtime value is always the original ArgMeta we stored, so we restore
  // the static type at the boundary.
  return argRegistry.get(schema) as ArgMeta | undefined;
}
