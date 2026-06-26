/**
 * Vendor-neutral field metadata model and the shared normalization that turns
 * `arg()` metadata plus schema-derived info into a {@link ResolvedFieldMeta}.
 *
 * This module is imported by every schema adapter (Zod, Valibot, the generic
 * Standard Schema adapter, and politty's internal schema) so they all produce
 * identical CLI metadata (alias / hiddenAlias / negation / ...). It contains no
 * runtime schema-library dependency.
 */

import type { z } from "zod";
import type { ArgsSchema } from "../types.js";
import type { ArgMeta, CompletionMeta, EffectContext, PromptMeta } from "./arg-registry.js";

/**
 * Long flag names reserved for built-in handling (parseArgs / scanForSubcommand
 * intercept these before option parsing), so custom negation names must avoid them.
 */
const RESERVED_NEGATION_NAMES: ReadonlySet<string> = new Set(["help", "help-all", "version"]);

/**
 * Resolved metadata for an argument field
 */
export interface ResolvedFieldMeta {
  /** Field name (camelCase, as defined in schema) */
  name: string;
  /** CLI option name (kebab-case, for command line usage) */
  cliName: string;
  /**
   * Aliases for this option, normalized to an array.
   * 1-char entries are short aliases (`-v`); multi-char entries are long
   * aliases (`--to-be`).
   */
  alias?: string[] | undefined;
  /**
   * Aliases that are accepted at parse time but hidden from help,
   * generated docs, and shell completion.
   */
  hiddenAlias?: string[] | undefined;
  /** Argument description */
  description?: string | undefined;
  /** Whether this is a positional argument */
  positional: boolean;
  /** Placeholder for help display */
  placeholder?: string | undefined;
  /**
   * Environment variable name(s) to read value from.
   * If an array, earlier entries take priority.
   */
  env?: string | string[] | undefined;
  /** Whether this argument is required */
  required: boolean;
  /** Default value if any */
  defaultValue?: unknown;
  /** Detected type from schema */
  type: "string" | "number" | "boolean" | "array" | "unknown";
  /** Original Zod schema */
  schema: z.ZodType;
  /** True if this overrides built-in aliases (-h, -H) */
  overrideBuiltinAlias?: true;
  /** Enum values if detected from schema (z.enum) */
  enumValues?: string[] | undefined;
  /** Completion metadata from arg() */
  completion?: CompletionMeta | undefined;
  /** Prompt metadata from arg() for interactive input */
  prompt?: PromptMeta | undefined;
  /**
   * Negation configuration for this boolean field.
   *
   * - String (e.g. `"disable-cache"`): the default `--no-<cliName>` form is
   *   suppressed and only `--<negation>` (plus its camelCase variant) is
   *   accepted as the negation flag.
   * - `true`: the default `--no-<cliName>` form is accepted **and** shown in
   *   help, generated docs, and shell completions.
   * - `false`: neither the default `--no-<cliName>` nor any custom name is
   *   accepted; the field only responds to the positive flag.
   * - `undefined`: the default `--no-<cliName>` is accepted by the parser
   *   but hidden from help/docs/completions.
   *
   * Only applies to boolean fields; populated as `undefined` otherwise.
   */
  negation?: string | boolean | undefined;
  /**
   * Derived display name (no `--` prefix) for the negation flag in help,
   * generated docs, and shell completions. `undefined` means the negation
   * is hidden from those surfaces. Computed from `negation` + `cliName`.
   */
  negationDisplay?: string | undefined;
  /** Description shown for the negation option in help/docs. */
  negationDescription?: string | undefined;
  /** Side-effect callback from arg() metadata */
  effect?: ((value: unknown, context: EffectContext) => void | PromiseLike<void>) | undefined;
}

/**
 * Extracted fields from a schema
 */
export interface ExtractedFields {
  /** All field definitions */
  fields: ResolvedFieldMeta[];
  /** Original schema for validation */
  schema: ArgsSchema;
  /** Schema type */
  schemaType: "object" | "discriminatedUnion" | "union" | "xor" | "intersection";
  /** Discriminator key (for discriminatedUnion) */
  discriminator?: string;
  /** Variants (for discriminatedUnion) */
  variants?: Array<{
    discriminatorValue: string;
    fields: ResolvedFieldMeta[];
    description?: string;
  }>;
  /** Options (for union) */
  unionOptions?: ExtractedFields[];
  /** Schema description */
  description?: string;
  /**
   * Unknown keys handling mode
   * - "strict": Unknown keys cause validation errors (z.strictObject or z.object().strict())
   * - "strip": Unknown keys trigger warnings (default, z.object())
   * - "passthrough": Unknown keys are silently ignored (z.looseObject or z.object().passthrough())
   */
  unknownKeysMode: UnknownKeysMode;
}

/**
 * Unknown keys handling mode for object schemas
 * - "strict": Unknown keys cause validation errors
 * - "strip": Unknown keys are silently ignored (default)
 * - "passthrough": Unknown keys are passed through
 */
export type UnknownKeysMode = "strict" | "strip" | "passthrough";

/**
 * Schema-derived inputs for a field, computed by the introspection backend
 * (Zod native `_def` walk, or JSON Schema walk) and then normalized identically.
 */
export interface DerivedFieldInfo {
  /** Description sourced from the schema (arg() metadata still takes priority). */
  description?: string | undefined;
  /** Detected base type. */
  type: "string" | "number" | "boolean" | "array" | "unknown";
  /** Whether the field is required. */
  required: boolean;
  /** Default value, if any. */
  defaultValue: unknown;
  /** Enum values, if the field is an enum/literal-union. */
  enumValues?: string[] | undefined;
  /** Original sub-schema reference (used by docs/golden tests). */
  schema: z.ZodType;
}

/**
 * Convert camelCase to kebab-case
 * @example toKebabCase("dryRun") => "dry-run"
 * @example toKebabCase("outputDir") => "output-dir"
 * @example toKebabCase("XMLParser") => "xml-parser"
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * Convert hyphen-separated sequences to camelCase.
 *
 * Replaces `-x` (hyphen followed by a lowercase letter) with the uppercase
 * variant. Non-hyphenated input (e.g., already camelCase) is returned as-is.
 *
 * @param str - A string that may contain hyphens
 * @example toCamelCase("dry-run") => "dryRun"
 * @example toCamelCase("output-dir") => "outputDir"
 * @example toCamelCase("dryRun") => "dryRun"
 */
export function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

/**
 * Build a {@link ResolvedFieldMeta} from `arg()` metadata plus schema-derived
 * info. Holds all CLI-metadata normalization (alias / hiddenAlias / negation /
 * ...) and is shared by every extraction backend.
 */
export function buildFieldMeta(
  name: string,
  argMeta: ArgMeta | undefined,
  derived: DerivedFieldInfo,
): ResolvedFieldMeta {
  // Priority: argRegistry > schema description
  const description = argMeta?.description ?? derived.description;

  // Convert camelCase field name to kebab-case for CLI usage
  const cliName = toKebabCase(name);

  const enumValues = derived.enumValues;
  const fieldType = derived.type;

  // Normalize alias-like inputs to a deduped, validated array (or undefined when empty).
  // Leading dashes are stripped for convenience; entries that still fail the pattern after
  // stripping cause a validation error so that invalid aliases are never silently ignored.
  const aliasPattern = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
  const normalizeAliasList = (
    input: unknown,
    metaKey: "alias" | "hiddenAlias",
  ): string[] | undefined => {
    if (input == null) return undefined;
    const arr = Array.isArray(input) ? input : [input];
    const normalized = arr.map((a) => {
      if (typeof a !== "string") {
        throw new Error(
          `Invalid ${metaKey} for field "${name}": expected string or string[], received ${typeof a}.`,
        );
      }
      const candidate = a.trim().replace(/^-+/, "");
      if (candidate.length === 0 || !aliasPattern.test(candidate)) {
        throw new Error(
          `Invalid ${metaKey} "${a}" for field "${name}": aliases must match ${aliasPattern}.`,
        );
      }
      return candidate;
    });
    const result = Array.from(new Set(normalized));
    return result.length > 0 ? result : undefined;
  };

  const alias = normalizeAliasList(argMeta?.alias, "alias");
  // Filter hiddenAlias so it never overlaps with visible alias (visible wins)
  const visibleSet = new Set(alias ?? []);
  const hiddenAliasRaw = normalizeAliasList(
    (argMeta as { hiddenAlias?: string | string[] } | undefined)?.hiddenAlias,
    "hiddenAlias",
  );
  const hiddenAlias = hiddenAliasRaw?.filter((a) => !visibleSet.has(a));
  const hiddenAliasFinal = hiddenAlias && hiddenAlias.length > 0 ? hiddenAlias : undefined;

  // Validate and normalize `negation` (only meaningful for boolean fields).
  // Accepts:
  //   - string: custom negation CLI name (suppresses default `--no-*`)
  //   - true:   keep default `--no-*` and advertise it in help/docs/completion
  //   - false:  disable negation entirely (default `--no-*` also rejected)
  const rawNegation = (argMeta as { negation?: unknown } | undefined)?.negation;
  let negation: string | boolean | undefined;
  if (rawNegation !== undefined && rawNegation !== null) {
    if (typeof rawNegation === "boolean") {
      if (fieldType !== "boolean") {
        throw new Error(
          `Invalid negation for field "${name}": negation can only be used on boolean fields.`,
        );
      }
      negation = rawNegation;
    } else {
      if (typeof rawNegation !== "string") {
        throw new Error(
          `Invalid negation for field "${name}": expected string or boolean, received ${typeof rawNegation}.`,
        );
      }
      const candidate = rawNegation.trim().replace(/^-+/, "");
      if (candidate.length === 0 || !aliasPattern.test(candidate)) {
        throw new Error(
          `Invalid negation "${rawNegation}" for field "${name}": negation names must match ${aliasPattern}.`,
        );
      }
      if (RESERVED_NEGATION_NAMES.has(candidate)) {
        throw new Error(
          `Invalid negation "${rawNegation}" for field "${name}": negation cannot use reserved built-in flag names (${[
            ...RESERVED_NEGATION_NAMES,
          ]
            .map((n) => `--${n}`)
            .join(", ")}).`,
        );
      }
      if (fieldType !== "boolean") {
        throw new Error(
          `Invalid negation for field "${name}": negation can only be used on boolean fields.`,
        );
      }
      negation = candidate;
    }
  }

  const rawNegationDescription = (argMeta as { negationDescription?: unknown } | undefined)
    ?.negationDescription;
  let negationDescription: string | undefined;
  if (rawNegationDescription !== undefined && rawNegationDescription !== null) {
    if (typeof rawNegationDescription !== "string") {
      throw new Error(
        `Invalid negationDescription for field "${name}": expected string, received ${typeof rawNegationDescription}.`,
      );
    }
    if (negation === false) {
      throw new Error(
        `Invalid negationDescription for field "${name}": negationDescription cannot be used when negation is false.`,
      );
    }
    if (negation === undefined) {
      throw new Error(
        `Invalid negationDescription for field "${name}": negationDescription requires \`negation\` to be set (string or true).`,
      );
    }
    // Reject blank strings: downstream rendering treats falsy values as
    // "no description provided" and collapses to the inline `/` form, so
    // an empty/whitespace-only string would be silently ignored.
    const trimmed = rawNegationDescription.trim();
    if (trimmed.length === 0) {
      throw new Error(
        `Invalid negationDescription for field "${name}": negationDescription must be a non-empty string.`,
      );
    }
    negationDescription = trimmed;
  }

  // Compute the displayed negation name (without leading `--`) for help,
  // generated docs, and shell completions. `undefined` means hidden.
  const negationDisplay: string | undefined =
    typeof negation === "string" ? negation : negation === true ? `no-${cliName}` : undefined;

  const meta: ResolvedFieldMeta = {
    name,
    cliName,
    alias,
    hiddenAlias: hiddenAliasFinal,
    description,
    positional: argMeta?.positional ?? false,
    placeholder: argMeta?.placeholder,
    env: argMeta?.env,
    required: derived.required,
    defaultValue: derived.defaultValue,
    type: fieldType,
    schema: derived.schema,
    enumValues,
    completion: argMeta?.completion,
    prompt: argMeta?.prompt,
    negation,
    negationDisplay,
    negationDescription,
    effect: argMeta?.effect,
  };

  // Add overrideBuiltinAlias only if it's true
  if (argMeta && "overrideBuiltinAlias" in argMeta && argMeta.overrideBuiltinAlias === true) {
    meta.overrideBuiltinAlias = true;
  }

  return meta;
}

/**
 * Get the combined list of visible + hidden aliases for a field.
 * Used by the parser and validators which treat both equally,
 * while help/docs/completion rely on `field.alias` only.
 */
export function getAllAliases(field: ResolvedFieldMeta): string[] {
  if (!field.alias && !field.hiddenAlias) return [];
  return [...(field.alias ?? []), ...(field.hiddenAlias ?? [])];
}
