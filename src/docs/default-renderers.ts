import type { ResolvedFieldMeta } from "../core/schema-extractor.js";
import type { Example } from "../types.js";
import type {
  ArgumentsRenderContext,
  CommandInfo,
  DefaultRendererOptions,
  ExampleExecutionResult,
  ExamplesRenderContext,
  ExamplesRenderOptions,
  OptionsRenderContext,
  RenderContentOptions,
  RenderFunction,
  SimpleRenderContext,
  SubCommandInfo,
  SubcommandsRenderContext,
  SubcommandsRenderOptions,
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
 * Format environment variable info for display
 */
function formatEnvInfo(env: string | string[] | undefined): string {
  if (!env) return "";
  const envNames = Array.isArray(env) ? env : [env];
  return ` [env: ${envNames.join(", ")}]`;
}

/**
 * Format option flags (uses kebab-case cliName)
 */
function formatOptionFlags(opt: ResolvedFieldMeta): string {
  const parts: string[] = [];

  // Use cliName (kebab-case) for CLI display
  const placeholder = opt.placeholder ?? opt.cliName.toUpperCase().replace(/-/g, "_");
  const longFlag =
    opt.type === "boolean" ? `--${opt.cliName}` : `--${opt.cliName} <${placeholder}>`;

  if (opt.alias) {
    parts.push(`\`-${opt.alias}\`, \`${longFlag}\``);
  } else {
    parts.push(`\`${longFlag}\``);
  }

  return parts.join("");
}

/**
 * Render options as markdown table
 *
 * Features:
 * - Uses kebab-case (cliName) for option names (e.g., `--dry-run` instead of `--dryRun`)
 * - Automatically adds Env column when any option has env configured
 * - Displays multiple env vars as comma-separated list
 *
 * @example
 * | Option | Alias | Description | Required | Default | Env |
 * |--------|-------|-------------|----------|---------|-----|
 * | `--dry-run` | `-d` | Dry run mode | No | `false` | - |
 * | `--port <PORT>` | - | Server port | Yes | - | `PORT`, `SERVER_PORT` |
 */
export function renderOptionsTable(info: CommandInfo): string {
  if (info.options.length === 0) {
    return "";
  }

  // Check if any option has env configured
  const hasEnv = info.options.some((opt) => opt.env);

  const lines: string[] = [];
  if (hasEnv) {
    lines.push("| Option | Alias | Description | Required | Default | Env |");
    lines.push("|--------|-------|-------------|----------|---------|-----|");
  } else {
    lines.push("| Option | Alias | Description | Required | Default |");
    lines.push("|--------|-------|-------------|----------|---------|");
  }

  for (const opt of info.options) {
    // Use cliName (kebab-case) for CLI display
    const placeholder = opt.placeholder ?? opt.cliName.toUpperCase().replace(/-/g, "_");
    const optionName =
      opt.type === "boolean" ? `\`--${opt.cliName}\`` : `\`--${opt.cliName} <${placeholder}>\``;
    const alias = opt.alias ? `\`-${opt.alias}\`` : "-";
    const desc = escapeTableCell(opt.description ?? "");
    const required = opt.required ? "Yes" : "No";
    const defaultVal = formatDefaultValue(opt.defaultValue);

    if (hasEnv) {
      const envNames = opt.env
        ? Array.isArray(opt.env)
          ? opt.env.map((e) => `\`${e}\``).join(", ")
          : `\`${opt.env}\``
        : "-";
      lines.push(
        `| ${optionName} | ${alias} | ${desc} | ${required} | ${defaultVal} | ${envNames} |`,
      );
    } else {
      lines.push(`| ${optionName} | ${alias} | ${desc} | ${required} | ${defaultVal} |`);
    }
  }

  return lines.join("\n");
}

/**
 * Render options as markdown list
 *
 * Features:
 * - Uses kebab-case (cliName) for option names (e.g., `--dry-run` instead of `--dryRun`)
 * - Appends env info at the end of each option (e.g., `[env: PORT, SERVER_PORT]`)
 *
 * @example
 * - `-d`, `--dry-run` - Dry run mode (default: false)
 * - `--port <PORT>` - Server port (required) [env: PORT, SERVER_PORT]
 */
export function renderOptionsList(info: CommandInfo): string {
  if (info.options.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (const opt of info.options) {
    const flags = formatOptionFlags(opt);
    const desc = opt.description ? ` - ${opt.description}` : "";
    const required = opt.required ? " (required)" : "";
    const defaultVal =
      opt.defaultValue !== undefined ? ` (default: ${JSON.stringify(opt.defaultValue)})` : "";
    const envInfo = formatEnvInfo(opt.env);
    lines.push(`- ${flags}${desc}${required}${defaultVal}${envInfo}`);
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
 * Render options from array as table
 */
export function renderOptionsTableFromArray(options: ResolvedFieldMeta[]): string {
  if (options.length === 0) {
    return "";
  }

  // Check if any option has env configured
  const hasEnv = options.some((opt) => opt.env);

  const lines: string[] = [];
  if (hasEnv) {
    lines.push("| Option | Alias | Description | Required | Default | Env |");
    lines.push("|--------|-------|-------------|----------|---------|-----|");
  } else {
    lines.push("| Option | Alias | Description | Required | Default |");
    lines.push("|--------|-------|-------------|----------|---------|");
  }

  for (const opt of options) {
    const placeholder = opt.placeholder ?? opt.cliName.toUpperCase().replace(/-/g, "_");
    const optionName =
      opt.type === "boolean" ? `\`--${opt.cliName}\`` : `\`--${opt.cliName} <${placeholder}>\``;
    const alias = opt.alias ? `\`-${opt.alias}\`` : "-";
    const desc = escapeTableCell(opt.description ?? "");
    const required = opt.required ? "Yes" : "No";
    const defaultVal = formatDefaultValue(opt.defaultValue);

    if (hasEnv) {
      const envNames = opt.env
        ? Array.isArray(opt.env)
          ? opt.env.map((e) => `\`${e}\``).join(", ")
          : `\`${opt.env}\``
        : "-";
      lines.push(
        `| ${optionName} | ${alias} | ${desc} | ${required} | ${defaultVal} | ${envNames} |`,
      );
    } else {
      lines.push(`| ${optionName} | ${alias} | ${desc} | ${required} | ${defaultVal} |`);
    }
  }

  return lines.join("\n");
}

/**
 * Render options from array as list
 */
export function renderOptionsListFromArray(options: ResolvedFieldMeta[]): string {
  if (options.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (const opt of options) {
    const flags = formatOptionFlags(opt);
    const desc = opt.description ? ` - ${opt.description}` : "";
    const required = opt.required ? " (required)" : "";
    const defaultVal =
      opt.defaultValue !== undefined ? ` (default: ${JSON.stringify(opt.defaultValue)})` : "";
    const envInfo = formatEnvInfo(opt.env);
    lines.push(`- ${flags}${desc}${required}${defaultVal}${envInfo}`);
  }

  return lines.join("\n");
}

/**
 * Render arguments from array as table
 */
export function renderArgumentsTableFromArray(args: ResolvedFieldMeta[]): string {
  if (args.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("| Argument | Description | Required |");
  lines.push("|----------|-------------|----------|");

  for (const arg of args) {
    const desc = escapeTableCell(arg.description ?? "");
    const required = arg.required ? "Yes" : "No";
    lines.push(`| \`${arg.name}\` | ${desc} | ${required} |`);
  }

  return lines.join("\n");
}

/**
 * Render arguments from array as list
 */
export function renderArgumentsListFromArray(args: ResolvedFieldMeta[]): string {
  if (args.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (const arg of args) {
    const required = arg.required ? "(required)" : "(optional)";
    const desc = arg.description ? ` - ${arg.description}` : "";
    lines.push(`- \`${arg.name}\`${desc} ${required}`);
  }

  return lines.join("\n");
}

/**
 * Render subcommands from array as table
 */
export function renderSubcommandsTableFromArray(
  subcommands: SubCommandInfo[],
  info: CommandInfo,
  generateAnchors = true,
): string {
  if (subcommands.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("| Command | Description |");
  lines.push("|---------|-------------|");

  const currentFile = info.filePath;
  const fileMap = info.fileMap;

  for (const sub of subcommands) {
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
 * Render examples as markdown
 *
 * @example
 * **Basic usage**
 *
 * ```bash
 * $ greet World
 * ```
 *
 * Output:
 * ```
 * Hello, World!
 * ```
 */
export function renderExamplesDefault(
  examples: Example[],
  results?: ExampleExecutionResult[],
  opts?: ExamplesRenderOptions,
): string {
  if (examples.length === 0) {
    return "";
  }

  const showOutput = opts?.showOutput ?? true;
  const prefix = opts?.commandPrefix ? `${opts.commandPrefix} ` : "";
  const lines: string[] = [];

  for (let i = 0; i < examples.length; i++) {
    const example = examples[i];
    if (!example) continue;

    const result = results?.[i];

    // Description as bold text
    lines.push(`**${example.desc}**`);
    lines.push("");

    // Command and output in a single code block
    lines.push("```bash");
    lines.push(`$ ${prefix}${example.cmd}`);

    // Output
    if (showOutput) {
      if (result) {
        // Use captured output from execution
        if (result.stdout) {
          lines.push(result.stdout);
        }
        if (result.stderr) {
          lines.push(`[stderr] ${result.stderr}`);
        }
      } else if (example.output) {
        // Use expected output from definition
        lines.push(example.output);
      }
    }

    lines.push("```");
    lines.push("");
  }

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

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
    renderNotes: customRenderNotes,
    renderFooter: customRenderFooter,
    renderExamples: customRenderExamples,
  } = options;

  return (info: CommandInfo): string => {
    const lines: string[] = [];
    // Calculate effective heading level based on command depth
    // depth=1 → headingLevel, depth=2 → headingLevel+1, etc.
    const effectiveLevel = Math.min(headingLevel + (info.depth - 1), 6);
    const h = "#".repeat(effectiveLevel);

    // Title - use commandPath for subcommands, name for root
    const title = info.commandPath || info.name;
    lines.push(`${h} ${title}`);
    lines.push("");

    // Description
    if (info.description) {
      const context: SimpleRenderContext = {
        content: info.description,
        heading: "",
        info,
      };
      const content = customRenderDescription ? customRenderDescription(context) : context.content;
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Usage
    {
      const defaultUsage = `**Usage**\n\n\`\`\`\n${renderUsage(info)}\n\`\`\``;
      const context: SimpleRenderContext = {
        content: defaultUsage,
        heading: "**Usage**",
        info,
      };
      const content = customRenderUsage ? customRenderUsage(context) : context.content;
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Arguments
    if (info.positionalArgs.length > 0) {
      const renderArgs = (args: ResolvedFieldMeta[], opts?: RenderContentOptions): string => {
        const style = opts?.style ?? optionStyle;
        const withHeading = opts?.withHeading ?? true;
        const content =
          style === "table"
            ? renderArgumentsTableFromArray(args)
            : renderArgumentsListFromArray(args);
        return withHeading ? `**Arguments**\n\n${content}` : content;
      };

      const context: ArgumentsRenderContext = {
        args: info.positionalArgs,
        render: renderArgs,
        heading: "**Arguments**",
        info,
      };

      const content = customRenderArguments
        ? customRenderArguments(context)
        : renderArgs(context.args);
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Options
    if (info.options.length > 0) {
      const renderOpts = (opts: ResolvedFieldMeta[], renderOpts?: RenderContentOptions): string => {
        const style = renderOpts?.style ?? optionStyle;
        const withHeading = renderOpts?.withHeading ?? true;
        const content =
          style === "table" ? renderOptionsTableFromArray(opts) : renderOptionsListFromArray(opts);
        return withHeading ? `**Options**\n\n${content}` : content;
      };

      const context: OptionsRenderContext = {
        options: info.options,
        render: renderOpts,
        heading: "**Options**",
        info,
      };

      const content = customRenderOptions
        ? customRenderOptions(context)
        : renderOpts(context.options);
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Subcommands
    if (info.subCommands.length > 0) {
      const effectiveAnchors = generateAnchors && includeSubcommandDetails;

      const renderSubs = (subs: SubCommandInfo[], opts?: SubcommandsRenderOptions): string => {
        const anchors = opts?.generateAnchors ?? effectiveAnchors;
        const withHeading = opts?.withHeading ?? true;
        const content = renderSubcommandsTableFromArray(subs, info, anchors);
        return withHeading ? `**Commands**\n\n${content}` : content;
      };

      const context: SubcommandsRenderContext = {
        subcommands: info.subCommands,
        render: renderSubs,
        heading: "**Commands**",
        info,
      };

      const content = customRenderSubcommands
        ? customRenderSubcommands(context)
        : renderSubs(context.subcommands);
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Examples
    if (info.examples && info.examples.length > 0) {
      const renderEx = (
        examples: Example[],
        results?: ExampleExecutionResult[],
        opts?: ExamplesRenderOptions,
      ): string => {
        const withHeading = opts?.withHeading ?? true;
        const mergedOpts: ExamplesRenderOptions = {
          commandPrefix: info.fullCommandPath,
          ...opts,
        };
        const content = renderExamplesDefault(examples, results, mergedOpts);
        return withHeading ? `**Examples**\n\n${content}` : content;
      };

      const context: ExamplesRenderContext = {
        examples: info.examples,
        results: info.exampleResults,
        render: renderEx,
        heading: "**Examples**",
        info,
      };

      const content = customRenderExamples
        ? customRenderExamples(context)
        : renderEx(context.examples, context.results);
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Notes
    if (info.notes) {
      const context: SimpleRenderContext = {
        content: `**Notes**\n\n${info.notes}`,
        heading: "**Notes**",
        info,
      };
      const content = customRenderNotes ? customRenderNotes(context) : context.content;
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }

    // Footer (default is empty)
    {
      const context: SimpleRenderContext = {
        content: "",
        heading: "",
        info,
      };
      const content = customRenderFooter ? customRenderFooter(context) : context.content;
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
