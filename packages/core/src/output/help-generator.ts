import {
  getAllAliases,
  getExtractedFields,
  type ExtractedFields,
  type ResolvedFieldMeta,
} from "../core/schema-extractor.js";
import { resolveSubCommandMeta } from "../lazy.js";
import type { AnyCommand, Example, SubCommandsRecord, SubCommandValue } from "../types.js";
import { styles } from "./logger.js";
import { renderMarkdown } from "./markdown-renderer.js";

/**
 * Descriptions for built-in options
 */
export interface BuiltinOptionDescriptions {
  /** Description for --help option */
  help?: string;
  /** Description for --help-all option */
  helpAll?: string;
  /** Description for --help-json option */
  helpJson?: string;
  /** Description for --version option */
  version?: string;
}

/**
 * Default descriptions for built-in options
 */
const defaultBuiltinDescriptions: Required<BuiltinOptionDescriptions> = {
  help: "Show help",
  helpAll: "Show help with all subcommand options",
  helpJson: "Show help as JSON",
  version: "Show version",
};

/**
 * Context for command hierarchy
 */
export interface CommandContext {
  /** Full command path (e.g., ["config", "get"]) */
  commandPath?: string[] | undefined;
  /** Root command name */
  rootName?: string | undefined;
  /** Root command version */
  rootVersion?: string | undefined;
  /** Extracted fields from global args schema */
  globalExtracted?: ExtractedFields | undefined;
  /** When the command was accessed via an alias, the canonical command name */
  aliasFor?: string | undefined;
}

/**
 * Options for help generation
 */
export interface HelpOptions {
  /** Show subcommand list */
  showSubcommands?: boolean | undefined;
  /** Show subcommand options */
  showSubcommandOptions?: boolean | undefined;
  /** Custom descriptions for built-in options */
  descriptions?: BuiltinOptionDescriptions | undefined;
  /** Command hierarchy context */
  context?: CommandContext | undefined;
}

/**
 * Serializable representation of a single argument (positional or option),
 * whitelisted from {@link ResolvedFieldMeta} down to JSON-safe fields.
 * `schema`, `completion`, `prompt`, and `effect` are intentionally omitted:
 * they carry library-specific schema objects and callbacks that cannot
 * round-trip through JSON, and text help never surfaces them either.
 */
export interface HelpFieldData {
  /** Field name (camelCase, as defined in the schema) */
  name: string;
  /** CLI option name (kebab-case) */
  cliName: string;
  /** Whether this is a positional argument */
  positional: boolean;
  /** Whether this argument is required */
  required: boolean;
  /** Detected type from schema */
  type: "string" | "number" | "boolean" | "array" | "unknown";
  /** Aliases for this option (short: 1 char, long: multi-char) */
  alias?: string[] | undefined;
  /** Argument description */
  description?: string | undefined;
  /** Placeholder shown in help */
  placeholder?: string | undefined;
  /** Environment variable name(s) to read value from */
  env?: string | string[] | undefined;
  /** Default value, if any */
  defaultValue?: unknown;
  /** Enum values, if detected from schema */
  enumValues?: string[] | undefined;
  /** Negation configuration (see {@link ResolvedFieldMeta.negation}) */
  negation?: string | boolean | undefined;
  /** Derived negation flag name (no `--` prefix), or undefined when hidden */
  negationDisplay?: string | undefined;
  /** Description shown for the negation option */
  negationDescription?: string | undefined;
}

/**
 * A named group of fields sharing a discriminated-union variant or a plain
 * union option (see {@link ExtractedFields.variants} / `.unionOptions`).
 */
export interface HelpVariantData {
  /** Discriminator value this variant matches (discriminated unions only) */
  discriminatorValue?: string | undefined;
  /** Variant/option description */
  description?: string | undefined;
  /**
   * Fields unique to this variant/option (common fields are not repeated
   * here). Positional fields unique to this variant/option are included too,
   * duplicated from the flat top-level {@link HelpData.positionals}, so JSON
   * consumers can attribute a positional to the variant/option it belongs to.
   */
  fields: HelpFieldData[];
}

/**
 * Structured usage information, equivalent in content to {@link renderUsageLine}
 * but free of ANSI styling and rendering order decisions, so JSON consumers
 * can format it however they like.
 */
export interface HelpUsageData {
  /** Command name as shown in usage (includes root name for subcommands) */
  commandName: string;
  /** Whether global options are defined */
  hasGlobalOptions: boolean;
  /** Whether this command defines any (non-positional) options */
  hasOptions: boolean;
  /**
   * Whether a subcommand token is expected: "required" when the command has
   * no `run` of its own, "optional" when it does. Undefined when the
   * command has no (visible) subcommands.
   */
  subcommand?: "required" | "optional" | undefined;
  /** Positional arguments in order */
  positionals: Array<{ name: string; required: boolean }>;
}

/**
 * A subcommand entry in {@link HelpData.subcommands}.
 */
export interface HelpSubcommandData {
  /** Subcommand name (key under `subCommands`) */
  name: string;
  /** Subcommand aliases */
  aliases?: string[] | undefined;
  /**
   * Set when this subcommand is a legacy async factory (`() => Promise<Command>`)
   * registered without {@link lazy}, so no synchronous metadata is available
   * and `data` cannot be produced. `lazy()` subcommands are always resolved
   * (their `meta` is synchronous) and never hit this case.
   */
  unresolved?: true | undefined;
  /** Full structured help for this subcommand, recursively. Absent when `unresolved` is true. */
  data?: HelpData | undefined;
}

/**
 * Structured, JSON-serializable representation of a command's help.
 * Produced by {@link generateHelpData}; the machine-readable counterpart of
 * {@link generateHelp}'s formatted text.
 */
export interface HelpData {
  /** Command name (command.name) */
  name: string;
  /** Full path from the root command (empty at the root) */
  commandPath: string[];
  /**
   * Root command name. Always set when produced through `runMain`/`runCommand`
   * (equal to `name` itself at the root); `undefined` only when
   * `generateHelpData` is called directly without a `context`.
   */
  rootName?: string | undefined;
  /** Root command version, when provided to runMain/runCommand */
  version?: string | undefined;
  /** Canonical subcommand name, set only when this command was reached via an alias */
  aliasFor?: string | undefined;
  /** Command description */
  description?: string | undefined;
  /** Command aliases (as a subcommand) */
  aliases?: string[] | undefined;
  /** Structured usage line */
  usage: HelpUsageData;
  /** Descriptions of the built-in --help/--help-all/--help-json/--version options */
  builtinOptions: {
    help: string;
    helpAll: string;
    helpJson: string;
    version?: string | undefined;
  };
  /** Args schema shape: a plain object, or a union/discriminated-union of variants */
  schemaType?: "object" | "discriminatedUnion" | "union" | "xor" | "intersection" | undefined;
  /** Positional arguments */
  positionals: HelpFieldData[];
  /**
   * Non-positional options. For `discriminatedUnion`/`union`/`xor` schemas,
   * this holds only the fields common to every variant/option; the rest are
   * under `variants`/`unionOptions`.
   */
  options: HelpFieldData[];
  /** Discriminator field name (discriminatedUnion schemas only) */
  discriminator?: string | undefined;
  /** Per-variant fields (discriminatedUnion schemas only) */
  variants?: HelpVariantData[] | undefined;
  /** Per-option fields (union/xor schemas only) */
  unionOptions?: HelpVariantData[] | undefined;
  /** Global options shared across all commands, when a global args schema is defined */
  globalOptions?: HelpFieldData[] | undefined;
  /** Subcommands, recursively resolved */
  subcommands?: HelpSubcommandData[] | undefined;
  /** Example usages */
  examples?: Example[] | undefined;
  /** Additional notes (raw Markdown, unrendered) */
  notes?: string | undefined;
}

/**
 * Internal subcommands are reserved for framework internals and hidden from help output.
 */
function isVisibleSubcommand(name: string): boolean {
  return !name.startsWith("__");
}

function getVisibleSubcommandEntries(
  subCommands: SubCommandsRecord,
): Array<[string, SubCommandValue]> {
  return Object.entries(subCommands).filter(([name]) => isVisibleSubcommand(name));
}

/**
 * Build full command name from context
 */
function buildFullCommandName(command: AnyCommand, context?: CommandContext): string {
  if (context?.rootName && context.commandPath && context.commandPath.length > 0) {
    // Subcommand: show path (e.g., "config get")
    return context.commandPath.join(" ");
  }
  return command.name ?? "command";
}

/**
 * Build usage command name (includes root name for subcommands)
 */
function buildUsageCommandName(command: AnyCommand, context?: CommandContext): string {
  if (context?.rootName && context.commandPath && context.commandPath.length > 0) {
    // Subcommand: include root name (e.g., "git-like config get")
    return `${context.rootName} ${context.commandPath.join(" ")}`;
  }
  return command.name ?? "command";
}

/**
 * Render the usage line for a command
 */
export function renderUsageLine(command: AnyCommand, context?: CommandContext): string {
  const parts: string[] = [];
  const name = buildUsageCommandName(command, context);

  parts.push(styles.commandName(name));

  // Add [global options] if global args are defined
  if (context?.globalExtracted?.fields.length) {
    parts.push(styles.placeholder("[global options]"));
  }

  const extracted = getExtractedFields(command);
  if (extracted) {
    const positionals = extracted.fields.filter((a) => a.positional);
    const options = extracted.fields.filter((a) => !a.positional);

    // Add [options] if there are options
    if (options.length > 0) {
      parts.push(styles.placeholder("[options]"));
    }

    // Add <command> or [command] if there are subcommands
    if (command.subCommands && getVisibleSubcommandEntries(command.subCommands).length > 0) {
      if (command.run) {
        parts.push(styles.placeholder("[command]"));
      } else {
        parts.push(styles.option("<command>"));
      }
    }

    // Add positional arguments
    for (const arg of positionals) {
      if (arg.required) {
        parts.push(styles.option(`<${arg.name}>`));
      } else {
        parts.push(styles.placeholder(`[${arg.name}]`));
      }
    }
  } else {
    // Add <command> or [command] if there are subcommands
    if (command.subCommands && getVisibleSubcommandEntries(command.subCommands).length > 0) {
      if (command.run) {
        parts.push(styles.placeholder("[command]"));
      } else {
        parts.push(styles.option("<command>"));
      }
    }
  }

  return parts.join(" ");
}

/**
 * Render the options section
 */
export function renderOptions(
  command: AnyCommand,
  descriptions: BuiltinOptionDescriptions = {},
  context?: CommandContext,
): string {
  const lines: string[] = [];
  const desc: Required<BuiltinOptionDescriptions> = {
    help: descriptions.help ?? defaultBuiltinDescriptions.help,
    helpAll: descriptions.helpAll ?? defaultBuiltinDescriptions.helpAll,
    helpJson: descriptions.helpJson ?? defaultBuiltinDescriptions.helpJson,
    version: descriptions.version ?? defaultBuiltinDescriptions.version,
  };

  const extracted = getExtractedFields(command);

  // Check if user has overridden built-in aliases (includes hiddenAlias since the
  // parser routes those to the user's field, making the built-in -h/-H misleading)
  const hasUserDefinedh =
    extracted?.fields.some(
      (f) => f.overrideBuiltinAlias === true && getAllAliases(f).includes("h"),
    ) ?? false;
  const hasUserDefinedH =
    extracted?.fields.some(
      (f) => f.overrideBuiltinAlias === true && getAllAliases(f).includes("H"),
    ) ?? false;

  // Add built-in options
  if (hasUserDefinedh) {
    // Don't show -h alias if user is using it
    lines.push(formatOption(styles.option("--help"), desc.help));
  } else {
    lines.push(formatOption(`${styles.option("-h")}, ${styles.option("--help")}`, desc.help));
  }

  if (hasUserDefinedH) {
    // Don't show -H alias if user is using it
    lines.push(formatOption(styles.option("--help-all"), desc.helpAll));
  } else {
    lines.push(
      formatOption(`${styles.option("-H")}, ${styles.option("--help-all")}`, desc.helpAll),
    );
  }

  lines.push(formatOption(styles.option("--help-json"), desc.helpJson));

  // Show --version only if version is provided in context
  if (context?.rootVersion) {
    lines.push(formatOption(styles.option("--version"), desc.version));
  }

  if (!extracted) {
    return lines.join("\n");
  }

  // Handle discriminated union specially
  if (extracted.schemaType === "discriminatedUnion" && extracted.discriminator) {
    return renderDiscriminatedUnionOptions(extracted, command, lines);
  }

  // Handle union specially
  if (extracted.schemaType === "union" && extracted.unionOptions) {
    return renderUnionOptions(extracted, command, lines);
  }

  // Handle xor (exclusive union) the same as union
  if (extracted.schemaType === "xor" && extracted.unionOptions) {
    return renderUnionOptions(extracted, command, lines);
  }

  // Regular options
  const options = extracted.fields.filter((a) => !a.positional);
  for (const opt of options) {
    const flags = formatFlags(opt);
    let desc = opt.description ?? "";

    // Add default value indicator
    if (opt.defaultValue !== undefined) {
      desc += ` ${styles.defaultValue(`(default: ${JSON.stringify(opt.defaultValue)})`)}`;
    }

    // Add required indicator
    if (opt.required) {
      desc += ` ${styles.required("(required)")}`;
    }

    // Add environment variable info
    const envInfo = formatEnvInfo(opt.env);
    if (envInfo) {
      desc += ` ${envInfo}`;
    }

    lines.push(formatOption(flags, desc));

    // Render the custom negation as a separate line when a description is provided
    const negationLine = formatNegationLine(opt);
    if (negationLine) {
      lines.push(negationLine);
    }
  }

  return lines.join("\n");
}

/**
 * Render a separate line for the custom negation option when a
 * `negationDescription` is provided. When no description is given, the
 * negation is shown inline by `formatFlags`.
 */
function formatNegationLine(
  opt: ResolvedFieldMeta,
  indent = 0,
  extraDescPadding = 0,
): string | null {
  if (!opt.negationDisplay || !opt.negationDescription) return null;
  const flag = styles.option(`--${opt.negationDisplay}`);
  const desc = `${opt.negationDescription} ${styles.dim(`(↔ --${opt.cliName})`)}`;
  return formatOption(flag, desc, indent, extraDescPadding);
}

/**
 * Render options for discriminated union with variants
 */
function renderDiscriminatedUnionOptions(
  extracted: ExtractedFields,
  _command: AnyCommand,
  lines: string[],
): string {
  const discriminator = extracted.discriminator!;
  const variants = extracted.variants ?? [];

  // Add discriminator field
  const discriminatorField = extracted.fields.find((f) => f.name === discriminator);
  if (discriminatorField) {
    const variantValues = variants.map((v) => v.discriminatorValue).join("|");
    const flags = `${styles.option(`--${discriminator}`)} ${styles.placeholder(`<${variantValues}>`)}`;
    // Use discriminatedUnion's description for the discriminator field
    const description =
      extracted.description ?? discriminatorField.description ?? "Action to perform";
    lines.push(formatOption(flags, description));
  }

  // Add common fields (fields that appear in all variants)
  const commonFields = new Set<string>();
  const allFieldNames = new Set<string>();

  for (const variant of variants) {
    for (const field of variant.fields) {
      allFieldNames.add(field.name);
    }
  }

  for (const fieldName of allFieldNames) {
    if (fieldName === discriminator) continue;

    const inAllVariants = variants.every((v) => v.fields.some((f) => f.name === fieldName));
    if (inAllVariants) {
      commonFields.add(fieldName);
    }
  }

  // Render common fields
  for (const fieldName of commonFields) {
    const field = extracted.fields.find((f) => f.name === fieldName);
    if (field && !field.positional) {
      const flags = formatFlags(field);
      let desc = field.description ?? "";
      if (field.defaultValue !== undefined) {
        desc += ` ${styles.defaultValue(`(default: ${JSON.stringify(field.defaultValue)})`)}`;
      }
      const envInfo = formatEnvInfo(field.env);
      if (envInfo) {
        desc += ` ${envInfo}`;
      }
      lines.push(formatOption(flags, desc));
      const negationLine = formatNegationLine(field);
      if (negationLine) lines.push(negationLine);
    }
  }

  // Render variant-specific fields
  for (const variant of variants) {
    const variantFields = variant.fields.filter(
      (f) => f.name !== discriminator && !commonFields.has(f.name) && !f.positional,
    );

    if (variantFields.length > 0) {
      lines.push("");
      // Format: "When action=create: description" if description exists, otherwise "When action=create:"
      const variantLabel = variant.description
        ? `${styles.dim("When")} ${styles.option(discriminator)}=${styles.bold(variant.discriminatorValue)}: ${variant.description}`
        : `${styles.dim("When")} ${styles.option(discriminator)}=${styles.bold(variant.discriminatorValue)}:`;
      lines.push(variantLabel);

      for (const field of variantFields) {
        const flags = formatFlags(field);
        let desc = field.description ?? "";
        if (field.defaultValue !== undefined) {
          desc += ` ${styles.defaultValue(`(default: ${JSON.stringify(field.defaultValue)})`)}`;
        }
        if (field.required) {
          desc += ` ${styles.required("(required)")}`;
        }
        const envInfo = formatEnvInfo(field.env);
        if (envInfo) {
          desc += ` ${envInfo}`;
        }
        lines.push(formatOption(flags, desc, 1));
        const negationLine = formatNegationLine(field, 1);
        if (negationLine) lines.push(negationLine);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Render options for union with multiple options
 */
function renderUnionOptions(
  extracted: ExtractedFields,
  _command: AnyCommand,
  lines: string[],
): string {
  const unionOptions = extracted.unionOptions ?? [];

  // Add common fields (fields that appear in all options)
  const commonFields = new Set<string>();
  const allFieldNames = new Set<string>();

  for (const option of unionOptions) {
    for (const field of option.fields) {
      allFieldNames.add(field.name);
    }
  }

  for (const fieldName of allFieldNames) {
    const inAllOptions = unionOptions.every((o) => o.fields.some((f) => f.name === fieldName));
    if (inAllOptions) {
      commonFields.add(fieldName);
    }
  }

  // Render common fields
  for (const fieldName of commonFields) {
    const field = extracted.fields.find((f) => f.name === fieldName);
    if (field && !field.positional) {
      const flags = formatFlags(field);
      let desc = field.description ?? "";
      if (field.defaultValue !== undefined) {
        desc += ` ${styles.defaultValue(`(default: ${JSON.stringify(field.defaultValue)})`)}`;
      }
      const envInfo = formatEnvInfo(field.env);
      if (envInfo) {
        desc += ` ${envInfo}`;
      }
      lines.push(formatOption(flags, desc));
      const negationLine = formatNegationLine(field);
      if (negationLine) lines.push(negationLine);
    }
  }

  // Render option-specific fields
  for (let i = 0; i < unionOptions.length; i++) {
    const option = unionOptions[i];
    if (!option) continue;

    const uniqueFields = option.fields.filter((f) => !commonFields.has(f.name) && !f.positional);

    const label = option.description ?? `Variant ${i + 1}`;

    if (uniqueFields.length > 0) {
      lines.push("");
      lines.push(`  ${styles.bold(`${label}:`)}`);

      for (const field of uniqueFields) {
        const flags = formatFlags(field);
        let desc = field.description ?? "";
        if (field.defaultValue !== undefined) {
          desc += ` ${styles.defaultValue(`(default: ${JSON.stringify(field.defaultValue)})`)}`;
        }
        if (field.required) {
          desc += ` ${styles.required("(required)")}`;
        }
        const envInfo = formatEnvInfo(field.env);
        if (envInfo) {
          desc += ` ${envInfo}`;
        }
        lines.push(formatOption(flags, desc, 1));
        const negationLine = formatNegationLine(field, 1);
        if (negationLine) lines.push(negationLine);
      }
    } else {
      lines.push("");
      lines.push(`  ${styles.bold(`${label}:`)}`);
      lines.push(`    ${styles.dim(styles.italic("no options"))}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format option flags (-v, --verbose <VALUE>)
 * Uses cliName (kebab-case) for display
 */
function formatFlags(opt: ResolvedFieldMeta): string {
  // Aliases (including the canonical long flag) are joined with `, `.
  // The custom negation is joined with ` / ` so it stays visually distinct.
  const aliasParts: string[] = [];

  // Short aliases first (e.g., -v)
  if (opt.alias) {
    for (const alias of opt.alias) {
      if (alias.length === 1) {
        aliasParts.push(styles.option(`-${alias}`));
      }
    }
  }

  // Use cliName (kebab-case) for display
  let longFlag = styles.option(`--${opt.cliName}`);

  // Add placeholder for non-boolean options
  if (opt.type !== "boolean") {
    const placeholder = opt.placeholder ?? opt.cliName.toUpperCase();
    longFlag += ` ${styles.placeholder(`<${placeholder}>`)}`;
  }

  aliasParts.push(longFlag);

  // Long aliases (e.g., --to-be), with the same placeholder for non-boolean options
  if (opt.alias) {
    for (const alias of opt.alias) {
      if (alias.length > 1) {
        let longAlias = styles.option(`--${alias}`);
        if (opt.type !== "boolean") {
          const placeholder = opt.placeholder ?? opt.cliName.toUpperCase();
          longAlias += ` ${styles.placeholder(`<${placeholder}>`)}`;
        }
        aliasParts.push(longAlias);
      }
    }
  }

  const aliasStr = aliasParts.join(", ");

  // Custom negation for boolean fields (shown inline when no separate
  // negationDescription is provided). Separated by ` / ` to distinguish
  // negation from aliases, matching the inline form used in generated docs.
  if (opt.type === "boolean" && opt.negationDisplay && !opt.negationDescription) {
    return `${aliasStr} / ${styles.option(`--${opt.negationDisplay}`)}`;
  }

  return aliasStr;
}

/**
 * Format environment variable info for help display
 */
function formatEnvInfo(env: string | string[] | undefined): string {
  if (!env) return "";

  const envNames = Array.isArray(env) ? env : [env];
  return styles.dim(`[env: ${envNames.join(", ")}]`);
}

/**
 * Strip ANSI escape codes from a string to get visual length
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

/**
 * Pad a string that may contain ANSI codes to a visual width
 */
function padEndVisual(str: string, width: number): string {
  const visualLength = stripAnsi(str).length;
  const padding = Math.max(0, width - visualLength);
  return str + " ".repeat(padding);
}

/**
 * Re-indent the continuation lines of a multi-line description so they align
 * under the description column. A `\n` in a description is treated as a hard
 * line break; every line after the first is padded to `column` spaces.
 */
function indentDescription(description: string, column: number): string {
  if (!description.includes("\n")) return description;
  const pad = " ".repeat(column);
  return description.split("\n").join(`\n${pad}`);
}

/**
 * Format a single option line
 * If flags exceed the column width, description is moved to the next line
 *
 * Descriptions may contain `\n` line breaks; continuation lines are indented to
 * stay aligned under the description column.
 */
function formatOption(
  flags: string,
  description: string,
  indent = 0,
  extraDescPadding = 0,
): string {
  const flagWidth = 32;
  const indentStr = "  ".repeat(indent);
  const visualFlagLength = stripAnsi(flags).length;
  const effectiveFlagWidth = flagWidth - indent * 2 + extraDescPadding;
  const descColumn = effectiveFlagWidth + 2 + indent * 2;
  const desc = indentDescription(description, descColumn);

  // If flags are too long, put description on next line
  if (visualFlagLength >= effectiveFlagWidth) {
    const descIndent = " ".repeat(descColumn);
    return `${indentStr}  ${flags}\n${descIndent}${desc}`;
  }

  const paddedFlags = padEndVisual(flags, effectiveFlagWidth);
  return `${indentStr}  ${paddedFlags}${desc}`;
}

/**
 * Format a single option field as a help line
 */
function formatFieldLine(opt: ResolvedFieldMeta, indent = 0, extraDescPadding = 0): string {
  const flags = formatFlags(opt);
  let desc = opt.description ?? "";

  if (opt.defaultValue !== undefined) {
    desc += ` ${styles.defaultValue(`(default: ${JSON.stringify(opt.defaultValue)})`)}`;
  }

  if (opt.required) {
    desc += ` ${styles.required("(required)")}`;
  }

  const envInfo = formatEnvInfo(opt.env);
  if (envInfo) {
    desc += ` ${envInfo}`;
  }

  return formatOption(flags, desc, indent, extraDescPadding);
}

/**
 * Render global options section
 */
function renderGlobalOptions(globalExtracted: ExtractedFields): string {
  const lines: string[] = [];
  for (const opt of globalExtracted.fields) {
    if (opt.positional) continue;
    lines.push(formatFieldLine(opt));
    const negationLine = formatNegationLine(opt);
    if (negationLine) lines.push(negationLine);
  }
  return lines.join("\n");
}

/**
 * Render options for a subcommand (used by showSubcommandOptions)
 */
function renderSubcommandOptionsCompact(command: AnyCommand, indent: number): string[] {
  const lines: string[] = [];
  const extracted = getExtractedFields(command);

  if (extracted) {
    const options = extracted.fields.filter((a) => !a.positional);
    for (const opt of options) {
      const flags = formatFlags(opt);
      let desc = opt.description ?? "";
      if (opt.defaultValue !== undefined) {
        desc += ` ${styles.defaultValue(`(default: ${JSON.stringify(opt.defaultValue)})`)}`;
      }
      const envInfo = formatEnvInfo(opt.env);
      if (envInfo) {
        desc += ` ${envInfo}`;
      }
      lines.push(formatOption(flags, desc, indent, 2));
      const negationLine = formatNegationLine(opt, indent, 2);
      if (negationLine) lines.push(negationLine);
    }
  }

  return lines;
}

/**
 * Render subcommands recursively with their options (flat style)
 */
function renderSubcommandsWithOptions(
  subCommands: SubCommandsRecord,
  parentPath: string,
  baseIndent: number,
): string[] {
  const lines: string[] = [];

  for (const [name, subCmd] of getVisibleSubcommandEntries(subCommands)) {
    const cmd = resolveSubCommandMeta(subCmd);
    const fullPath = parentPath ? `${parentPath} ${name}` : name;
    const desc = cmd?.description ?? "";
    const aliases = cmd?.aliases;
    const displayName =
      aliases && aliases.length > 0 ? `${fullPath}, ${aliases.join(", ")}` : fullPath;

    // Add subcommand name with description (all subcommands at same indent level)
    lines.push(formatOption(styles.command(displayName), desc, baseIndent));

    if (cmd) {
      // Add subcommand options (one level deeper than the subcommand itself)
      const optionLines = renderSubcommandOptionsCompact(cmd, baseIndent + 1);
      lines.push(...optionLines);

      // Recursively add nested subcommands (same base indent - flat style)
      const visibleNestedSubCommands = cmd.subCommands
        ? Object.fromEntries(getVisibleSubcommandEntries(cmd.subCommands))
        : undefined;
      if (visibleNestedSubCommands && Object.keys(visibleNestedSubCommands).length > 0) {
        const nestedLines = renderSubcommandsWithOptions(
          visibleNestedSubCommands,
          fullPath,
          baseIndent,
        );
        lines.push(...nestedLines);
      }
    }
  }

  return lines;
}

/**
 * Generate help text for a command
 *
 * @param command - The command to generate help for
 * @param options - Help generation options
 * @returns Formatted help text
 */
export function generateHelp(command: AnyCommand, options: HelpOptions): string {
  const sections: string[] = [];
  const context = options.context;

  // Command name + version
  const displayName = buildFullCommandName(command, context);
  if (displayName) {
    let header = styles.commandName(displayName);
    // Show root name and version for subcommands, or version for root
    if (context?.rootName && context.commandPath && context.commandPath.length > 0) {
      // Subcommand: show (rootName vX.X.X)
      if (context.rootVersion) {
        header += ` ${styles.version(`(${context.rootName} v${context.rootVersion})`)}`;
      } else {
        header += ` ${styles.version(`(${context.rootName})`)}`;
      }
    } else if (context?.rootVersion) {
      // Root command: show vX.X.X
      header += ` ${styles.version(`v${context.rootVersion}`)}`;
    }
    sections.push(header);
  }

  // Alias info (when accessed via alias, show "Alias for <canonical>")
  if (context?.aliasFor) {
    sections.push(styles.dim(`Alias for ${styles.commandName(context.aliasFor)}`));
  }

  // Description
  if (command.description) {
    sections.push(command.description);
  }

  // Aliases (when the command defines aliases and was NOT accessed via alias)
  if (!context?.aliasFor && command.aliases && command.aliases.length > 0) {
    sections.push(
      `${styles.sectionHeader("Aliases:")} ${command.aliases.map((a) => styles.command(a)).join(", ")}`,
    );
  }

  // Usage
  sections.push(`${styles.sectionHeader("Usage:")} ${renderUsageLine(command, context)}`);

  // Options
  const optionsText = renderOptions(command, options.descriptions, context);
  if (optionsText) {
    sections.push(`${styles.sectionHeader("Options:")}\n${optionsText}`);
  }

  // Global Options
  if (context?.globalExtracted?.fields.length) {
    sections.push(
      `${styles.sectionHeader("Global Options:")}\n${renderGlobalOptions(context.globalExtracted)}`,
    );
  }

  // Subcommands
  if (
    options.showSubcommands !== false &&
    command.subCommands &&
    getVisibleSubcommandEntries(command.subCommands).length > 0
  ) {
    // Get current command path for prefixing subcommands
    const currentPath = context?.commandPath?.join(" ") ?? "";

    const visibleSubCommands = Object.fromEntries(getVisibleSubcommandEntries(command.subCommands));

    if (options.showSubcommandOptions) {
      // Show subcommands with their options (recursive)
      const subLines = renderSubcommandsWithOptions(visibleSubCommands, currentPath, 0);
      sections.push(`${styles.sectionHeader("Commands:")}\n${subLines.join("\n")}`);
    } else {
      // Show only subcommand names and descriptions
      const subLines: string[] = [];
      for (const [name, subCmd] of Object.entries(visibleSubCommands)) {
        const cmd = resolveSubCommandMeta(subCmd);
        const desc = cmd?.description ?? "";
        // Include parent path in subcommand name, plus aliases
        const fullName = currentPath ? `${currentPath} ${name}` : name;
        const aliases = cmd?.aliases;
        const displayName =
          aliases && aliases.length > 0 ? `${fullName}, ${aliases.join(", ")}` : fullName;
        subLines.push(formatOption(styles.command(displayName), desc));
      }
      sections.push(`${styles.sectionHeader("Commands:")}\n${subLines.join("\n")}`);
    }
  }

  // Examples
  if (command.examples && command.examples.length > 0) {
    const exampleLines = renderExamplesForHelp(command.examples, context);
    sections.push(`${styles.sectionHeader("Examples:")}\n${exampleLines}`);
  }

  // Notes (render Markdown for styled terminal output, indented under header)
  if (command.notes) {
    const rendered = renderMarkdown(command.notes);
    const indented = rendered
      .split("\n")
      .map((line) => (line === "" ? "" : `  ${line}`))
      .join("\n");
    sections.push(`${styles.sectionHeader("Notes:")}\n${indented}`);
  }

  return `\n${sections.join("\n\n")}\n`;
}

/**
 * Options for {@link generateHelpData}
 */
export interface HelpDataOptions {
  /** Custom descriptions for the --help/--help-all/--help-json/--version built-in options */
  descriptions?: BuiltinOptionDescriptions | undefined;
  /** Command hierarchy context */
  context?: CommandContext | undefined;
}

/**
 * Convert a {@link ResolvedFieldMeta} to its JSON-safe {@link HelpFieldData}
 * counterpart, dropping the schema/completion/prompt/effect internals.
 */
function toHelpFieldData(field: ResolvedFieldMeta): HelpFieldData {
  const data: HelpFieldData = {
    name: field.name,
    cliName: field.cliName,
    positional: field.positional,
    required: field.required,
    type: field.type,
  };
  if (field.alias) data.alias = field.alias;
  if (field.description !== undefined) data.description = field.description;
  if (field.placeholder !== undefined) data.placeholder = field.placeholder;
  if (field.env !== undefined) data.env = field.env;
  if (field.defaultValue !== undefined) data.defaultValue = field.defaultValue;
  if (field.enumValues !== undefined) data.enumValues = field.enumValues;
  if (field.negation !== undefined) data.negation = field.negation;
  if (field.negationDisplay !== undefined) data.negationDisplay = field.negationDisplay;
  if (field.negationDescription !== undefined) data.negationDescription = field.negationDescription;
  return data;
}

/**
 * Field names shared by every group (discriminated-union variants, or union
 * options). Mirrors the common-field detection in {@link renderDiscriminatedUnionOptions}
 * / {@link renderUnionOptions}; `exclude` drops the discriminator field, which
 * is reported separately regardless of whether every variant declares it.
 */
function computeCommonFieldNames(
  groups: Array<{ fields: ResolvedFieldMeta[] }>,
  exclude?: string,
): Set<string> {
  const allNames = new Set<string>();
  for (const group of groups) {
    for (const field of group.fields) {
      if (field.name !== exclude) allNames.add(field.name);
    }
  }
  const common = new Set<string>();
  for (const name of allNames) {
    if (groups.every((group) => group.fields.some((f) => f.name === name))) {
      common.add(name);
    }
  }
  return common;
}

/**
 * Build the structured usage info for {@link HelpData.usage}. Content-equivalent
 * to {@link renderUsageLine}, without ANSI styling or a fixed rendering order.
 */
function buildUsageData(command: AnyCommand, context?: CommandContext): HelpUsageData {
  const commandName = buildUsageCommandName(command, context);
  const hasGlobalOptions = !!context?.globalExtracted?.fields.length;

  const hasSubcommands = !!(
    command.subCommands && getVisibleSubcommandEntries(command.subCommands).length > 0
  );
  const subcommand: HelpUsageData["subcommand"] = hasSubcommands
    ? command.run
      ? "optional"
      : "required"
    : undefined;

  const extracted = getExtractedFields(command);
  const hasOptions = extracted ? extracted.fields.some((f) => !f.positional) : false;
  const positionals = extracted
    ? extracted.fields
        .filter((f) => f.positional)
        .map((f) => ({ name: f.name, required: f.required }))
    : [];

  return { commandName, hasGlobalOptions, hasOptions, subcommand, positionals };
}

/**
 * Generate a structured, JSON-serializable representation of a command's help.
 *
 * The machine-readable counterpart of {@link generateHelp}: same underlying
 * field metadata, but as plain data (no ANSI styling, no fixed layout) and
 * always including the full recursive subcommand tree (there is no
 * `--help`/`--help-all` depth distinction here).
 *
 * @param command - The command to generate help data for
 * @param options - Help data generation options
 * @returns Structured help data
 */
export function generateHelpData(command: AnyCommand, options: HelpDataOptions = {}): HelpData {
  const context = options.context;
  const currentPath = context?.commandPath ?? [];

  const builtinOptions: HelpData["builtinOptions"] = {
    help: options.descriptions?.help ?? defaultBuiltinDescriptions.help,
    helpAll: options.descriptions?.helpAll ?? defaultBuiltinDescriptions.helpAll,
    helpJson: options.descriptions?.helpJson ?? defaultBuiltinDescriptions.helpJson,
    ...(context?.rootVersion
      ? { version: options.descriptions?.version ?? defaultBuiltinDescriptions.version }
      : {}),
  };

  const extracted = getExtractedFields(command);
  let schemaType: HelpData["schemaType"];
  let positionals: HelpFieldData[] = [];
  let optionFields: HelpFieldData[] = [];
  let discriminator: string | undefined;
  let variants: HelpVariantData[] | undefined;
  let unionOptions: HelpVariantData[] | undefined;

  if (extracted) {
    schemaType = extracted.schemaType;
    positionals = extracted.fields.filter((f) => f.positional).map(toHelpFieldData);

    if (
      extracted.schemaType === "discriminatedUnion" &&
      extracted.discriminator &&
      extracted.variants
    ) {
      const disc = extracted.discriminator;
      discriminator = disc;
      const groups = extracted.variants;
      const commonNames = computeCommonFieldNames(groups, disc);
      const discriminatorField = extracted.fields.find((f) => f.name === disc && !f.positional);
      const commonFields = extracted.fields.filter((f) => !f.positional && commonNames.has(f.name));
      optionFields = [
        // Same description fallback as renderDiscriminatedUnionOptions's text
        // rendering, so the JSON output stays content-equivalent: the
        // discriminated union's own description (if any) wins, then the
        // discriminator field's own description, then a generic default.
        ...(discriminatorField
          ? [
              {
                ...toHelpFieldData(discriminatorField),
                description:
                  extracted.description ?? discriminatorField.description ?? "Action to perform",
              },
            ]
          : []),
        ...commonFields.map(toHelpFieldData),
      ];
      variants = groups.map((variant) => ({
        discriminatorValue: variant.discriminatorValue,
        description: variant.description,
        // Positional fields specific to this variant are included here too
        // (duplicated from the flat top-level `positionals`) so JSON
        // consumers can tell which variant a given positional belongs to.
        fields: variant.fields
          .filter((f) => f.name !== disc && !commonNames.has(f.name))
          .map(toHelpFieldData),
      }));
    } else if (
      (extracted.schemaType === "union" || extracted.schemaType === "xor") &&
      extracted.unionOptions
    ) {
      const groups = extracted.unionOptions;
      const commonNames = computeCommonFieldNames(groups);
      const commonFields = extracted.fields.filter((f) => !f.positional && commonNames.has(f.name));
      optionFields = commonFields.map(toHelpFieldData);
      unionOptions = groups.map((option) => ({
        description: option.description,
        // Positional fields specific to this option are included here too
        // (duplicated from the flat top-level `positionals`) so JSON
        // consumers can tell which option a given positional belongs to.
        fields: option.fields.filter((f) => !commonNames.has(f.name)).map(toHelpFieldData),
      }));
    } else {
      optionFields = extracted.fields.filter((f) => !f.positional).map(toHelpFieldData);
    }
  }

  const globalOptions = context?.globalExtracted?.fields.length
    ? context.globalExtracted.fields.filter((f) => !f.positional).map(toHelpFieldData)
    : undefined;

  let subcommands: HelpSubcommandData[] | undefined;
  if (command.subCommands) {
    const visibleSubCommands = getVisibleSubcommandEntries(command.subCommands);
    if (visibleSubCommands.length > 0) {
      subcommands = visibleSubCommands.map(([name, subCmd]) => {
        const resolved = resolveSubCommandMeta(subCmd);
        if (!resolved) {
          return { name, unresolved: true };
        }
        const subContext: CommandContext = {
          commandPath: [...currentPath, name],
          // Fall back to this command's own name so recursive subcommand
          // usage stays root-prefixed even when generateHelpData is called
          // directly on the root command without a context.
          rootName: context?.rootName ?? command.name,
          rootVersion: context?.rootVersion,
          globalExtracted: context?.globalExtracted,
        };
        return {
          name,
          aliases: resolved.aliases,
          data: generateHelpData(resolved, {
            descriptions: options.descriptions,
            context: subContext,
          }),
        };
      });
    }
  }

  return {
    name: command.name ?? "command",
    commandPath: currentPath,
    rootName: context?.rootName,
    version: context?.rootVersion,
    aliasFor: context?.aliasFor,
    description: command.description,
    aliases: command.aliases,
    usage: buildUsageData(command, context),
    builtinOptions,
    schemaType,
    positionals,
    options: optionFields,
    discriminator,
    variants,
    unionOptions,
    globalOptions,
    subcommands,
    examples: command.examples,
    notes: command.notes,
  };
}

/**
 * Render examples for CLI help output
 */
function renderExamplesForHelp(examples: Example[], context?: CommandContext): string {
  const lines: string[] = [];
  const cmdPrefix = context?.rootName ? `${context.rootName} ` : "";
  const cmdPath = context?.commandPath?.join(" ") ?? "";
  const fullPrefix = cmdPath ? `${cmdPrefix}${cmdPath} ` : cmdPrefix;

  for (const example of examples) {
    // Description (indent continuation lines of multi-line descriptions)
    lines.push(`  ${styles.dim(example.desc).split("\n").join("\n  ")}`);
    // Command
    lines.push(`    ${styles.dim("$")} ${fullPrefix}${example.cmd}`);
    // Output (if provided)
    if (example.output) {
      for (const line of example.output.split("\n")) {
        lines.push(`    ${line}`);
      }
    }
    lines.push(""); // Empty line between examples
  }

  // Remove trailing empty line
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}
