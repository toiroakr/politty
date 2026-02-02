import type { AnyCommand } from "../types.js";
import { collectAllCommands } from "./doc-generator.js";
import type { CommandInfo } from "./types.js";

/**
 * Escape markdown special characters in table cells
 */
function escapeTableCell(str: string): string {
  return str.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Generate anchor from command path
 */
function generateAnchor(commandPath: string): string {
  return commandPath.replace(/\s+/g, "-").toLowerCase();
}

/**
 * Configuration for a command category
 */
export type CommandCategory = {
  /** Category title (e.g., "Application Commands") */
  title: string;
  /** Category description */
  description: string;
  /** Command paths to include (parent commands will auto-expand to leaf commands) */
  commands: string[];
  /** Path to documentation file for links (e.g., "./cli/application.md") */
  docPath: string;
};

/**
 * Options for rendering command index
 */
export type CommandIndexOptions = {
  /** Base heading level (default: 3, which renders as ###) */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Only include leaf commands (commands without subcommands). Default: true */
  leafOnly?: boolean;
};

/**
 * Check if a command is a leaf (has no subcommands)
 */
function isLeafCommand(info: CommandInfo): boolean {
  return info.subCommands.length === 0;
}

/**
 * Expand commands to include their leaf subcommands
 * If a command has subcommands, recursively find all leaf commands under it
 */
function expandToLeafCommands(
  commandPaths: string[],
  allCommands: Map<string, CommandInfo>,
): string[] {
  const result: string[] = [];

  for (const cmdPath of commandPaths) {
    const info = allCommands.get(cmdPath);
    if (!info) continue;

    if (isLeafCommand(info)) {
      // Already a leaf command
      result.push(cmdPath);
    } else {
      // Find all leaf commands under this parent
      for (const [path, pathInfo] of allCommands) {
        // Check if this is a subcommand of the current command
        const isSubcommand =
          cmdPath === "" ? path.length > 0 : path.startsWith(cmdPath + " ") || path === cmdPath;

        if (isSubcommand && isLeafCommand(pathInfo)) {
          result.push(path);
        }
      }
    }
  }

  return result;
}

/**
 * Render a single category section
 */
function renderCategory(
  category: CommandCategory,
  allCommands: Map<string, CommandInfo>,
  headingLevel: number,
  leafOnly: boolean,
): string {
  const h = "#".repeat(headingLevel);
  const lines: string[] = [];

  // Category title with link
  lines.push(`${h} [${category.title}](${category.docPath})`);
  lines.push("");

  // Category description
  lines.push(category.description);
  lines.push("");

  // Determine which commands to include
  const commandPaths = leafOnly
    ? expandToLeafCommands(category.commands, allCommands)
    : category.commands;

  // Build command table
  lines.push("| Command | Description |");
  lines.push("|---------|-------------|");

  for (const cmdPath of commandPaths) {
    const info = allCommands.get(cmdPath);
    if (!info) continue;

    // Skip non-leaf commands if leafOnly is true
    if (leafOnly && !isLeafCommand(info)) continue;

    const displayName = cmdPath || info.name;
    const anchor = generateAnchor(displayName);
    const desc = escapeTableCell(info.description ?? "");

    lines.push(`| [${displayName}](${category.docPath}#${anchor}) | ${desc} |`);
  }

  return lines.join("\n");
}

/**
 * Render command index from categories
 *
 * Generates a category-based index of commands with links to documentation.
 *
 * @example
 * const categories: CommandCategory[] = [
 *   {
 *     title: "Application Commands",
 *     description: "Commands for managing applications.",
 *     commands: ["init", "generate", "apply"],
 *     docPath: "./cli/application.md",
 *   },
 * ];
 *
 * const index = await renderCommandIndex(mainCommand, categories);
 * // ### [Application Commands](./cli/application.md)
 * //
 * // Commands for managing applications.
 * //
 * // | Command | Description |
 * // |---------|-------------|
 * // | [init](./cli/application.md#init) | Initialize a project |
 * // ...
 *
 * @param command - Root command to extract command information from
 * @param categories - Category definitions for grouping commands
 * @param options - Rendering options
 * @returns Rendered markdown string
 */
export async function renderCommandIndex(
  command: AnyCommand,
  categories: CommandCategory[],
  options?: CommandIndexOptions,
): Promise<string> {
  const headingLevel = options?.headingLevel ?? 3;
  const leafOnly = options?.leafOnly ?? true;

  // Collect all commands
  const allCommands = await collectAllCommands(command);

  // Render each category
  const sections: string[] = [];
  for (const category of categories) {
    const section = renderCategory(category, allCommands, headingLevel, leafOnly);
    sections.push(section);
  }

  return sections.join("\n\n");
}
