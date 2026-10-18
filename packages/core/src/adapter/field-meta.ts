import type {
  ArgMeta,
  CompletionMeta,
  EffectContext,
  NestedKeyStyle,
  PromptMeta,
} from "../core/arg-registry.js";
import type { PackageRequirement } from "../package-requirements.js";
import type { ArgsSchema } from "../types.js";

/**
 * Long flag names reserved for built-in handling (parseArgs / scanForSubcommand
 * intercept these before option parsing). A field's `cliName` or any of its
 * long aliases must avoid them (checked in command-validator.ts), and so must
 * custom negation names (checked below in this file).
 */
export const RESERVED_BUILTIN_LONG_NAMES: ReadonlySet<string> = new Set([
  "help",
  "help-all",
  "help-json",
  "version",
]);

/**
 * Resolved metadata for an argument field
 */
export interface ResolvedFieldMeta {
  requiredPackages?: readonly Pick<PackageRequirement, "name" | "install" | "from">[] | undefined;
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
  /** Whether this is accepted as a long option (`--cli-name`) */
  named: boolean;
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
  /**
   * Field schemas of an object field, keyed by property name. Set by the
   * adapter; `extractFields` expands such a field into its leaf fields.
   */
  objectShape?: Record<string, unknown> | undefined;
  /**
   * Every member's property schemas of an object field defined by several
   * intersection members (see {@link mergeIntersectionField}).
   */
  objectShapes?: Array<Record<string, unknown>> | undefined;
  /** How an object field treats properties it does not define */
  objectUnknownKeys?: UnknownKeysMode | undefined;
  /**
   * Whether a transform (or a pipe into another schema) may replace an
   * object field's validated value, so its properties' values are not
   * what their own schemas produce
   */
  objectTransformed?: boolean | undefined;
  /** Naming style for the options an object field expands into */
  flatten?: NestedKeyStyle | undefined;
  /**
   * Set on a leaf expanded from an object field. Its value is parsed under
   * `name` and moved to `path` (e.g. `["config", "port"]`) before
   * validation.
   */
  nested?: NestedFieldInfo | undefined;
}

/**
 * Where a leaf expanded from an object field lives in the validated args
 */
export interface NestedFieldInfo {
  /** Property path, starting with the top-level field name */
  path: string[];
}

/**
 * An object field (or nested object) whose leaves were expanded into
 * options. Kept per field group so objects without any leaf are still known.
 */
export interface NestedObjectInfo {
  /** Property path, starting with the top-level field name */
  path: string[];
  /** Whether the object itself is required within its parent */
  required: boolean;
  /** Whether the object keeps properties it does not define */
  passthrough?: boolean | undefined;
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
    normalizeDiscriminator?: (value: unknown) => unknown;
    fields: ResolvedFieldMeta[];
    description?: string;
    /** Object fields expanded into this variant's fields */
    nestedObjects?: NestedObjectInfo[];
    /** Whether validation keeps properties this variant does not define */
    retainsUnknownKeys?: boolean;
  }>;
  /** Options (for union) */
  unionOptions?: ExtractedFields[];
  /** Object fields expanded into `fields` (see {@link NestedObjectInfo}) */
  nestedObjects?: NestedObjectInfo[];
  /** Schema description */
  description?: string;
  /**
   * Unknown keys handling mode
   * - "strict": Unknown keys cause validation errors (z.strictObject or z.object().strict())
   * - "strip": Unknown keys trigger warnings (default, z.object())
   * - "passthrough": Unknown keys are silently ignored (z.looseObject or z.object().passthrough())
   */
  unknownKeysMode: UnknownKeysMode;
  /**
   * Whether validation keeps properties the schema does not define, which a
   * typed catchall does even though unknown flags are not passed through
   */
  retainsUnknownKeys?: boolean | undefined;
  /**
   * The union (or discriminated union) members of an intersection, nested
   * intersections included. Its fields combine every branch of them, so
   * object fields in these members cannot be expanded per branch.
   */
  unionMembers?: ExtractedFields[] | undefined;
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
  /** Field schemas by property name, when the schema is an object */
  objectShape?: Record<string, unknown> | undefined;
  /** How the object treats properties it does not define */
  objectUnknownKeys?: UnknownKeysMode | undefined;
  /** Whether a transform may replace the object's validated value */
  objectTransformed?: boolean | undefined;
}

const NESTED_KEY_STYLES: readonly NestedKeyStyle[] = ["dot", "kebab", "camel"];

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
      if (RESERVED_BUILTIN_LONG_NAMES.has(candidate)) {
        throw new Error(
          `Invalid negation "${rawNegation}" for field "${name}": negation cannot use reserved built-in flag names (${[
            ...RESERVED_BUILTIN_LONG_NAMES,
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

  const rawFlatten = (argMeta as { flatten?: unknown } | undefined)?.flatten;
  if (rawFlatten !== undefined) {
    if (!NESTED_KEY_STYLES.includes(rawFlatten as NestedKeyStyle)) {
      throw new Error(
        `Invalid flatten "${String(rawFlatten)}" for field "${name}": expected one of ${NESTED_KEY_STYLES.map((s) => `"${s}"`).join(", ")}.`,
      );
    }
    if (!intro.objectShape) {
      throw new Error(
        `Invalid flatten for field "${name}": flatten can only be used on object fields.`,
      );
    }
  }

  const positional = argMeta?.positional;
  const meta: ResolvedFieldMeta = {
    name,
    cliName,
    alias,
    hiddenAlias: hiddenAliasFinal,
    description,
    positional: positional !== undefined && positional !== false,
    named: typeof positional === "object" ? positional.named === true : positional !== true,
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
    requiredPackages: argMeta?.requiredPackages,
    objectShape: intro.objectShape,
    objectUnknownKeys: intro.objectShape ? intro.objectUnknownKeys : undefined,
    objectTransformed: intro.objectShape ? intro.objectTransformed : undefined,
    flatten: rawFlatten as NestedKeyStyle | undefined,
  };

  // Add overrideBuiltinAlias only if it's true
  if (argMeta && "overrideBuiltinAlias" in argMeta && argMeta.overrideBuiltinAlias === true) {
    meta.overrideBuiltinAlias = true;
  }

  return meta;
}

/** Whether validating against extracted fields keeps properties they do not define */
export function retainsKeys(extracted: ExtractedFields): boolean {
  return extracted.retainsUnknownKeys ?? extracted.unknownKeysMode === "passthrough";
}

/**
 * Combine two definitions of the same field from the members of an
 * intersection: the first definition wins, except that two object fields
 * keep the property schemas of both (expanded together, so a property both
 * define as an object is merged in turn) and the object is required when
 * either member requires it. (An object default from either member is kept,
 * to be rejected when the field is expanded.)
 *
 * @param first - The definition seen first
 * @param next - A later definition of the same field
 * @returns The definition to keep
 */
export function mergeIntersectionField(
  first: ResolvedFieldMeta,
  next: ResolvedFieldMeta,
): ResolvedFieldMeta {
  if (!first.objectShape || !next.objectShape) return first;
  return {
    ...first,
    required: first.required || next.required,
    // `null` is a default too.
    defaultValue: first.defaultValue !== undefined ? first.defaultValue : next.defaultValue,
    // A property one member keeps stays in the merged output.
    objectUnknownKeys:
      first.objectUnknownKeys === "passthrough" || next.objectUnknownKeys === "passthrough"
        ? "passthrough"
        : first.objectUnknownKeys,
    objectTransformed: first.objectTransformed || next.objectTransformed,
    objectShapes: [
      ...(first.objectShapes ?? [first.objectShape]),
      ...(next.objectShapes ?? [next.objectShape]),
    ],
  };
}
