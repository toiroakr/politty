import type { ArgMeta, CompletionMeta, EffectContext, PromptMeta } from "../core/arg-registry.js";
import type { ArgsSchema } from "../types.js";

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
  /**
   * Original field schema, carried through opaquely for downstream
   * consumers. Its concrete type belongs to the adapter's schema library
   * (zod, valibot, or an internal descriptor); core never calls into it.
   */
  schema: unknown;
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
   * - `undefined`: no negation form is accepted or shown.
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
 * Get the combined list of visible + hidden aliases for a field.
 * Used by the parser and validators which treat both equally,
 * while help/docs/completion rely on `field.alias` only.
 */
export function getAllAliases(field: ResolvedFieldMeta): string[] {
  if (!field.alias && !field.hiddenAlias) return [];
  return [...(field.alias ?? []), ...(field.hiddenAlias ?? [])];
}

/**
 * What an adapter must introspect from a single field schema before the
 * neutral {@link resolveFieldMeta} assembly can produce a
 * {@link ResolvedFieldMeta}. Everything policy-like (alias normalization,
 * negation validation, kebab/camel naming) lives in core so every adapter
 * behaves identically; everything schema-representation-specific (how to
 * read a default value, detect an enum, find registered metadata) lives in
 * the adapter that fills this shape.
 */
export interface FieldIntrospection {
  /** arg() metadata attached to the schema (adapter-specific lookup) */
  argMeta: ArgMeta | undefined;
  /** Native schema description (e.g. zod's .describe()), used as fallback */
  description: string | undefined;
  /** Whether the field is required (no optional wrapper, no default) */
  required: boolean;
  /** Default value if the schema declares one */
  defaultValue: unknown;
  /** Coarse type bucket detected from the schema */
  type: ResolvedFieldMeta["type"];
  /** Enum values if the schema is enum-like */
  enumValues: string[] | undefined;
  /** The original schema, carried through for downstream consumers */
  schema: unknown;
}

/**
 * Assemble a {@link ResolvedFieldMeta} from adapter-provided introspection.
 * Single source of truth for alias/negation normalization and validation.
 */
export function resolveFieldMeta(name: string, intro: FieldIntrospection): ResolvedFieldMeta {
  const argMeta = intro.argMeta;

  // Priority: argRegistry > schema.describe()
  const description = argMeta?.description ?? intro.description;

  // Convert camelCase field name to kebab-case for CLI usage
  const cliName = toKebabCase(name);

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

  const fieldType = intro.type;

  // Validate and normalize `negation` (only meaningful for boolean fields).
  // Accepts:
  //   - string: custom negation CLI name (suppresses default `--no-*`)
  //   - true:   accept default `--no-*` and advertise it in help/docs/completion
  //   - false:  disable negation entirely (same as the default, but explicit)
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
    required: intro.required,
    defaultValue: intro.defaultValue,
    type: fieldType,
    schema: intro.schema,
    enumValues: intro.enumValues,
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
