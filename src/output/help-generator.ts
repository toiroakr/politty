import type { AnyCommand } from "../types.js";
import {
  extractFields,
  type ExtractedFields,
  type ResolvedFieldMeta,
} from "../core/schema-extractor.js";
import { styles } from "./logger.js";

/**
 * Descriptions for built-in options
 */
export interface BuiltinOptionDescriptions {
  /** Description for --help option */
  help?: string;
  /** Description for --help-all option */
  helpAll?: string;
  /** Description for --version option */
  version?: string;
}

/**
 * Default descriptions for built-in options
 */
const defaultBuiltinDescriptions: Required<BuiltinOptionDescriptions> = {
  help: "Show help",
  helpAll: "Show help with all subcommand options",
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
 * Get extracted fields from command
 */
function getExtractedFields(command: AnyCommand): ExtractedFields | null {
  if (!command.argsSchema) {
    return null;
  }
  return extractFields(command.argsSchema);
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

  const extracted = getExtractedFields(command);
  if (extracted) {
    const positionals = extracted.fields.filter((a) => a.positional);
    const options = extracted.fields.filter((a) => !a.positional);

    // Add [options] if there are options
    if (options.length > 0) {
      parts.push(styles.placeholder("[options]"));
    }

    // Add [command] if there are subcommands
    if (command.subCommands && Object.keys(command.subCommands).length > 0) {
      parts.push(styles.placeholder("[command]"));
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
    // Add [command] if there are subcommands
    if (command.subCommands && Object.keys(command.subCommands).length > 0) {
      parts.push(styles.placeholder("[command]"));
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
): string {
  const lines: string[] = [];
  const desc: Required<BuiltinOptionDescriptions> = {
    help: descriptions.help ?? defaultBuiltinDescriptions.help,
    helpAll: descriptions.helpAll ?? defaultBuiltinDescriptions.helpAll,
    version: descriptions.version ?? defaultBuiltinDescriptions.version,
  };

  const extracted = getExtractedFields(command);

  // Check if user has overridden built-in aliases
  const hasUserDefinedh =
    extracted?.fields.some((f) => f.alias === "h" && f.overrideBuiltinAlias === true) ?? false;
  const hasUserDefinedH =
    extracted?.fields.some((f) => f.alias === "H" && f.overrideBuiltinAlias === true) ?? false;

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

  if (command.version) {
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

    lines.push(formatOption(flags, desc));
  }

  return lines.join("\n");
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
      lines.push(formatOption(flags, desc));
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
        lines.push(formatOption(`  ${flags}`, desc));
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
      lines.push(formatOption(flags, desc));
    }
  }

  // Render option-specific fields
  for (let i = 0; i < unionOptions.length; i++) {
    const option = unionOptions[i];
    if (!option) continue;

    const uniqueFields = option.fields.filter((f) => !commonFields.has(f.name) && !f.positional);

    if (uniqueFields.length > 0) {
      lines.push("");

      const label = option.description ?? `Variant ${i + 1}`;
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
        lines.push(formatOption(`  ${flags}`, desc));
      }
    }
  }

  return lines.join("\n");
}

/**
 * Format option flags (-v, --verbose <VALUE>)
 */
function formatFlags(opt: ResolvedFieldMeta): string {
  const parts: string[] = [];

  if (opt.alias) {
    parts.push(styles.option(`-${opt.alias}`));
  }

  let longFlag = styles.option(`--${opt.name}`);

  // Add placeholder for non-boolean options
  if (opt.type !== "boolean") {
    const placeholder = opt.placeholder ?? opt.name.toUpperCase();
    longFlag += ` ${styles.placeholder(`<${placeholder}>`)}`;
  }

  parts.push(longFlag);

  return parts.join(", ");
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
 * Format a single option line
 */
function formatOption(
  flags: string,
  description: string,
  indent = 0,
  extraDescPadding = 0,
): string {
  const flagWidth = 28;
  const indentStr = "  ".repeat(indent);
  const paddedFlags = padEndVisual(flags, flagWidth - indent * 2 + extraDescPadding);
  return `${indentStr}  ${paddedFlags}${description}`;
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
      lines.push(formatOption(flags, desc, indent, 2));
    }
  }

  return lines;
}

/**
 * Render subcommands recursively with their options (flat style)
 */
function renderSubcommandsWithOptions(
  subCommands: Record<string, AnyCommand | (() => Promise<AnyCommand>)>,
  parentPath: string,
  baseIndent: number,
): string[] {
  const lines: string[] = [];

  for (const [name, subCmd] of Object.entries(subCommands)) {
    // Handle both sync and async commands
    const cmd = typeof subCmd === "function" ? null : subCmd;
    const fullPath = parentPath ? `${parentPath} ${name}` : name;
    const desc = cmd?.description ?? "";

    // Add subcommand name with description (all subcommands at same indent level)
    lines.push(formatOption(styles.command(fullPath), desc, baseIndent));

    if (cmd) {
      // Add subcommand options (one level deeper than the subcommand itself)
      const optionLines = renderSubcommandOptionsCompact(cmd, baseIndent + 1);
      lines.push(...optionLines);

      // Recursively add nested subcommands (same base indent - flat style)
      if (cmd.subCommands && Object.keys(cmd.subCommands).length > 0) {
        const nestedLines = renderSubcommandsWithOptions(cmd.subCommands, fullPath, baseIndent);
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

  // Build header block (name + version + description without empty line)
  const headerLines: string[] = [];
  const displayName = buildFullCommandName(command, context);
  if (displayName) {
    let header = styles.commandName(displayName);
    // Show root name and version for subcommands, or command's own version for root
    if (context?.rootName && context.commandPath && context.commandPath.length > 0) {
      // Subcommand: show (rootName vX.X.X)
      if (context.rootVersion) {
        header += ` ${styles.version(`(${context.rootName} v${context.rootVersion})`)}`;
      } else {
        header += ` ${styles.version(`(${context.rootName})`)}`;
      }
    } else if (command.version) {
      // Root command: show vX.X.X
      header += ` ${styles.version(`v${command.version}`)}`;
    }
    headerLines.push(header);
  }

  // Description (no empty line after header)
  if (command.description) {
    headerLines.push(command.description);
  }

  if (headerLines.length > 0) {
    sections.push(headerLines.join("\n"));
  }

  // Usage
  sections.push(`${styles.sectionHeader("Usage:")} ${renderUsageLine(command, context)}`);

  // Options
  const optionsText = renderOptions(command, options.descriptions);
  if (optionsText) {
    sections.push(`${styles.sectionHeader("Options:")}\n${optionsText}`);
  }

  // Subcommands
  if (
    options.showSubcommands !== false &&
    command.subCommands &&
    Object.keys(command.subCommands).length > 0
  ) {
    // Get current command path for prefixing subcommands
    const currentPath = context?.commandPath?.join(" ") ?? "";

    if (options.showSubcommandOptions) {
      // Show subcommands with their options (recursive)
      const subLines = renderSubcommandsWithOptions(command.subCommands, currentPath, 0);
      sections.push(`${styles.sectionHeader("Commands:")}\n${subLines.join("\n")}`);
    } else {
      // Show only subcommand names and descriptions
      const subLines: string[] = [];
      for (const [name, subCmd] of Object.entries(command.subCommands)) {
        // Handle both sync and async commands
        const cmd = typeof subCmd === "function" ? { description: undefined } : subCmd;
        const desc = cmd.description ?? "";
        // Include parent path in subcommand name
        const fullName = currentPath ? `${currentPath} ${name}` : name;
        subLines.push(formatOption(styles.command(fullName), desc));
      }
      sections.push(`${styles.sectionHeader("Commands:")}\n${subLines.join("\n")}`);
    }
  }

  return sections.join("\n\n");
}
