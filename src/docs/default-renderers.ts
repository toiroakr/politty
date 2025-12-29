import type { ResolvedFieldMeta } from "../core/schema-extractor.js";
import type {
    CommandInfo,
    DefaultRendererOptions,
    RenderFunction,
    SectionRenderFunction
} from "./types.js";

/**
 * Escape markdown special characters in table cells
 */
function escapeTableCell(str: string): string {
  return str.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Format default value for display
 */
function formatDefaultValue(value: unknown): string {
  if (value === undefined) {
    return "-";
  }
  return `\`${JSON.stringify(value)}\``;
}

/**
 * Render usage line
 */
export function renderUsage(info: CommandInfo): string {
  const parts: string[] = [info.fullCommandPath];

  if (info.options.length > 0) {
    parts.push("[options]");
  }

  if (info.subCommands.length > 0) {
    parts.push("[command]");
  }

  for (const arg of info.positionalArgs) {
    if (arg.required) {
      parts.push(`<${arg.name}>`);
    } else {
      parts.push(`[${arg.name}]`);
    }
  }

  return parts.join(" ");
}

/**
 * Render arguments as table
 */
export function renderArgumentsTable(info: CommandInfo): string {
  if (info.positionalArgs.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("| Argument | Description | Required |");
  lines.push("|----------|-------------|----------|");

  for (const arg of info.positionalArgs) {
    const desc = escapeTableCell(arg.description ?? "");
    const required = arg.required ? "Yes" : "No";
    lines.push(`| \`${arg.name}\` | ${desc} | ${required} |`);
  }

  return lines.join("\n");
}

/**
 * Render arguments as list
 */
export function renderArgumentsList(info: CommandInfo): string {
  if (info.positionalArgs.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (const arg of info.positionalArgs) {
    const required = arg.required ? "(required)" : "(optional)";
    const desc = arg.description ? ` - ${arg.description}` : "";
    lines.push(`- \`${arg.name}\`${desc} ${required}`);
  }

  return lines.join("\n");
}

/**
 * Format option flags
 */
function formatOptionFlags(opt: ResolvedFieldMeta): string {
  const parts: string[] = [];

  const longFlag =
    opt.type === "boolean"
      ? `--${opt.name}`
      : `--${opt.name} <${opt.placeholder ?? opt.name.toUpperCase()}>`;

  if (opt.alias) {
    parts.push(`\`-${opt.alias}\`, \`${longFlag}\``);
  } else {
    parts.push(`\`${longFlag}\``);
  }

  return parts.join("");
}

/**
 * Render options as table
 */
export function renderOptionsTable(info: CommandInfo): string {
  if (info.options.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("| Option | Alias | Description | Default |");
  lines.push("|--------|-------|-------------|---------|");

  for (const opt of info.options) {
    const optionName =
      opt.type === "boolean"
        ? `\`--${opt.name}\``
        : `\`--${opt.name} <${opt.placeholder ?? opt.name.toUpperCase()}>\``;
    const alias = opt.alias ? `\`-${opt.alias}\`` : "-";
    const desc = escapeTableCell(opt.description ?? "");
    const defaultVal = formatDefaultValue(opt.defaultValue);
    lines.push(`| ${optionName} | ${alias} | ${desc} | ${defaultVal} |`);
  }

  return lines.join("\n");
}

/**
 * Render options as list
 */
export function renderOptionsList(info: CommandInfo): string {
  if (info.options.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (const opt of info.options) {
    const flags = formatOptionFlags(opt);
    const desc = opt.description ? ` - ${opt.description}` : "";
    const defaultVal =
      opt.defaultValue !== undefined ? ` (default: ${JSON.stringify(opt.defaultValue)})` : "";
    lines.push(`- ${flags}${desc}${defaultVal}`);
  }

  return lines.join("\n");
}

/**
 * Generate anchor from command path
 */
function generateAnchor(commandPath: string[]): string {
  return commandPath.join("-").toLowerCase();
}

/**
 * Generate relative path from one file to another
 */
function getRelativePath(from: string, to: string): string {
  const fromParts = from.split("/").slice(0, -1); // directory of 'from'
  const toParts = to.split("/");

  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length - 1 &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  // Build relative path
  const upCount = fromParts.length - commonLength;
  const relativeParts = [...Array(upCount).fill(".."), ...toParts.slice(commonLength)];

  return relativeParts.join("/") || (toParts[toParts.length - 1] ?? "");
}

/**
 * Render subcommands as table
 */
export function renderSubcommandsTable(info: CommandInfo, generateAnchors = true): string {
  if (info.subCommands.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("| Command | Description |");
  lines.push("|---------|-------------|");

  const currentFile = info.filePath;
  const fileMap = info.fileMap;

  for (const sub of info.subCommands) {
    const fullName = sub.fullPath.join(" ");
    const desc = escapeTableCell(sub.description ?? "");
    const subCommandPath = sub.fullPath.join(" ");

    if (generateAnchors) {
      const anchor = generateAnchor(sub.fullPath);
      const subFile = fileMap?.[subCommandPath];

      if (currentFile && subFile && currentFile !== subFile) {
        // Cross-file link
        const relativePath = getRelativePath(currentFile, subFile);
        lines.push(`| [\`${fullName}\`](${relativePath}#${anchor}) | ${desc} |`);
      } else {
        // Same-file anchor
        lines.push(`| [\`${fullName}\`](#${anchor}) | ${desc} |`);
      }
    } else {
      lines.push(`| \`${fullName}\` | ${desc} |`);
    }
  }

  return lines.join("\n");
}

/**
 * Identity function for section rendering (returns default content as-is)
 */
const identityRender: SectionRenderFunction = (content) => content;

/**
 * Create command renderer with options
 */
export function createCommandRenderer(options: DefaultRendererOptions = {}): RenderFunction {
  const {
    headingLevel = 1,
    optionStyle = "table",
    generateAnchors = true,
    includeSubcommandDetails = true,
    renderDescription: customRenderDescription,
    renderUsage: customRenderUsage,
    renderArguments: customRenderArguments,
    renderOptions: customRenderOptions,
    renderSubcommands: customRenderSubcommands,
    renderFooter: customRenderFooter,
  } = options;

  // Use custom render functions or identity
  const renderDescriptionFn = customRenderDescription ?? identityRender;
  const renderUsageFn = customRenderUsage ?? identityRender;
  const renderArgumentsFn = customRenderArguments ?? identityRender;
  const renderOptionsFn = customRenderOptions ?? identityRender;
  const renderSubcommandsFn = customRenderSubcommands ?? identityRender;
  const renderFooterFn = customRenderFooter ?? identityRender;

  return (info: CommandInfo): string => {
    const lines: string[] = [];
    const h = "#".repeat(headingLevel);
    const h2 = "#".repeat(headingLevel + 1);

    // Title
    lines.push(`${h} ${info.name}`);
    lines.push("");

    // Description
    if (info.description) {
      const defaultDescription = info.description;
      const content = renderDescriptionFn(defaultDescription, info);
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Usage
    {
      const defaultUsage = `${h2} Usage\n\n\`\`\`\n${renderUsage(info)}\n\`\`\``;
      const content = renderUsageFn(defaultUsage, info);
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Arguments
    if (info.positionalArgs.length > 0) {
      const argsContent =
        optionStyle === "table" ? renderArgumentsTable(info) : renderArgumentsList(info);
      const defaultArguments = `${h2} Arguments\n\n${argsContent}`;
      const content = renderArgumentsFn(defaultArguments, info);
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Options
    if (info.options.length > 0) {
      const optionsContent =
        optionStyle === "table" ? renderOptionsTable(info) : renderOptionsList(info);
      const defaultOptions = `${h2} Options\n\n${optionsContent}`;
      const content = renderOptionsFn(defaultOptions, info);
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Subcommands
    if (info.subCommands.length > 0) {
      const subcommandsContent = renderSubcommandsTable(
        info,
        generateAnchors && includeSubcommandDetails,
      );
      const defaultSubcommands = `${h2} Commands\n\n${subcommandsContent}`;
      const content = renderSubcommandsFn(defaultSubcommands, info);
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Footer (default is empty)
    {
      const content = renderFooterFn("", info);
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Remove trailing empty lines and ensure single newline at end
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    lines.push("");

    return lines.join("\n");
  };
}

/**
 * Default renderers presets
 */
export const defaultRenderers = {
  /** Standard command documentation */
  command: (options?: DefaultRendererOptions) => createCommandRenderer(options),
  /** Table style options (default) */
  tableStyle: createCommandRenderer({ optionStyle: "table" }),
  /** List style options */
  listStyle: createCommandRenderer({ optionStyle: "list" }),
};
