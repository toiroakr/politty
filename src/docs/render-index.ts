import type { AnyCommand } from "../types.js";
import { collectAllCommands } from "./doc-generator.js";
import type { CommandIndexOptions, CommandInfo } from "./types.js";

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
  /** Optional post-expansion allowlist, used when a caller has already applied ignores */
  allowedCommands?: string[];
  /** Path to documentation file for links (e.g., "./cli/application.md") */
  docPath: string;
  /**
   * When true, `commands` are used verbatim as index rows without expanding
   * parent commands to their leaf subcommands. Used for template-derived
   * categories where only explicitly rendered scopes have headings.
   */
  noExpand?: boolean;
};

export type { CommandIndexOptions };

/**
 * Check if a command is a leaf (has no subcommands)
 */
function isLeafCommand(info: CommandInfo): boolean {
  return info.subCommands.length === 0;
}

function isSubcommandOf(childPath: string, parentPath: string): boolean {
  if (childPath === parentPath) return true;
  if (parentPath === "") return childPath !== "";
  return childPath.startsWith(parentPath + " ");
}

/**
 * Expand commands to include their subcommands
 * If a command has subcommands, recursively find all commands under it
 *
 * @param commandPaths - Command paths to expand
 * @param allCommands - Map of all available commands
 * @param leafOnly - If true, only include leaf commands; if false, include all commands
 */
function expandCommands(
  commandPaths: string[],
  allCommands: Map<string, CommandInfo>,
  leafOnly: boolean,
): string[] {
  const result: string[] = [];

  for (const cmdPath of commandPaths) {
    const info = allCommands.get(cmdPath);
    if (!info) continue;

    if (isLeafCommand(info)) {
      // Already a leaf command
      result.push(cmdPath);
    } else {
      // Find all commands under this parent
      for (const [path, pathInfo] of allCommands) {
        // Check if this is a subcommand of the current command
        const isSubcommand =
          cmdPath === "" ? path.length > 0 : path.startsWith(cmdPath + " ") || path === cmdPath;

        if (isSubcommand) {
          // Include if it's a leaf command, or if we're including all commands
          if (isLeafCommand(pathInfo) || !leafOnly) {
            result.push(path);
          }
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

  // Determine which commands to include. noExpand categories (template-derived) use
  // their command list verbatim so the index lists exactly the rendered scopes;
  // otherwise parent commands expand to leaf subcommands (leafOnly controls filtering).
  const commandPaths = category.noExpand
    ? category.commands
    : expandCommands(category.commands, allCommands, leafOnly);
  let visibleCommandPaths = commandPaths;
  const fallbackCommandPaths = new Set<string>();
  if (category.allowedCommands) {
    const allowed = new Set(category.allowedCommands);
    visibleCommandPaths = commandPaths.filter((cmdPath) => allowed.has(cmdPath));
    for (const configuredPath of category.commands) {
      if (
        allowed.has(configuredPath) &&
        !visibleCommandPaths.some((cmdPath) => isSubcommandOf(cmdPath, configuredPath))
      ) {
        visibleCommandPaths.push(configuredPath);
        fallbackCommandPaths.add(configuredPath);
      }
    }
  }

  // Build command table
  lines.push("| Command | Description |");
  lines.push("|---------|-------------|");

  for (const cmdPath of visibleCommandPaths) {
    const info = allCommands.get(cmdPath);
    if (!info) continue;

    // Skip non-leaf commands if leafOnly is true (not applied to noExpand categories,
    // whose scopes are explicit and must all be listed).
    if (
      !category.noExpand &&
      leafOnly &&
      !fallbackCommandPaths.has(cmdPath) &&
      !isLeafCommand(info)
    ) {
      continue;
    }

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
