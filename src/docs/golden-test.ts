import { createCommandRenderer } from "./default-renderers.js";
import { compareWithExisting, writeFile } from "./doc-comparator.js";
import { collectAllCommands } from "./doc-generator.js";
import { executeExamples } from "./example-executor.js";
import type {
  CommandInfo,
  ExampleConfig,
  FileConfig,
  FormatterFunction,
  GenerateDocConfig,
  GenerateDocResult,
  RenderFunction,
} from "./types.js";
import { UPDATE_GOLDEN_ENV } from "./types.js";

/**
 * Apply formatter to content if provided
 * Supports both sync and async formatters
 */
async function applyFormatter(
  content: string,
  formatter: FormatterFunction | undefined,
): Promise<string> {
  if (!formatter) {
    return content;
  }
  return await formatter(content);
}

/**
 * Check if update mode is enabled via environment variable
 */
function isUpdateMode(): boolean {
  const value = process.env[UPDATE_GOLDEN_ENV];
  return value === "true" || value === "1";
}

/**
 * Normalize file mapping entry to FileConfig
 */
function normalizeFileConfig(config: string[] | FileConfig): FileConfig {
  if (Array.isArray(config)) {
    return { commands: config };
  }
  return config;
}

/**
 * Check if a command path is a subcommand of another
 */
function isSubcommandOf(childPath: string, parentPath: string): boolean {
  if (parentPath === "") return true; // Root is parent of everything
  if (childPath === parentPath) return true;
  return childPath.startsWith(parentPath + " ");
}

/**
 * Expand command paths to include all subcommands
 */
function expandCommandPaths(
  commandPaths: string[],
  allCommands: Map<string, CommandInfo>,
): string[] {
  const expanded = new Set<string>();

  for (const cmdPath of commandPaths) {
    // Add the command itself
    if (allCommands.has(cmdPath)) {
      expanded.add(cmdPath);
    }
    // Add all subcommands
    for (const path of allCommands.keys()) {
      if (isSubcommandOf(path, cmdPath)) {
        expanded.add(path);
      }
    }
  }

  return Array.from(expanded);
}

/**
 * Filter out ignored commands and their subcommands
 */
function filterIgnoredCommands(commandPaths: string[], ignores: string[]): string[] {
  return commandPaths.filter((path) => {
    return !ignores.some((ignorePath) => isSubcommandOf(path, ignorePath));
  });
}

/**
 * Validate that there are no conflicts between files and ignores
 */
function validateNoConflicts(filesCommands: string[], ignores: string[]): void {
  const conflicts: string[] = [];

  for (const filePath of filesCommands) {
    for (const ignorePath of ignores) {
      if (filePath === ignorePath || isSubcommandOf(filePath, ignorePath)) {
        conflicts.push(`"${filePath}" is both in files and ignored by "${ignorePath}"`);
      }
    }
  }

  if (conflicts.length > 0) {
    throw new Error(`Conflict between files and ignores:\n  - ${conflicts.join("\n  - ")}`);
  }
}

/**
 * Sort command paths in depth-first order while preserving the specified command order
 * Parent commands are immediately followed by their subcommands
 */
function sortDepthFirst(commandPaths: string[], specifiedOrder: string[]): string[] {
  // Build a set of all paths for quick lookup
  const pathSet = new Set(commandPaths);

  // Find top-level commands (those that match specified order or have no parent in the set)
  const topLevelPaths = specifiedOrder.filter((cmd) => pathSet.has(cmd));

  // Also include any commands not in specifiedOrder (for safety)
  for (const path of commandPaths) {
    const depth = path === "" ? 0 : path.split(" ").length;
    if (depth === 1 && !topLevelPaths.includes(path)) {
      topLevelPaths.push(path);
    }
  }

  const result: string[] = [];
  const visited = new Set<string>();

  function addWithChildren(cmdPath: string): void {
    if (visited.has(cmdPath) || !pathSet.has(cmdPath)) return;
    visited.add(cmdPath);
    result.push(cmdPath);

    // Find and add direct children in alphabetical order
    const children = commandPaths
      .filter((p) => {
        if (p === cmdPath || visited.has(p)) return false;
        // Check if p is a direct child of cmdPath
        if (cmdPath === "") {
          return p.split(" ").length === 1;
        }
        return p.startsWith(cmdPath + " ") && p.split(" ").length === cmdPath.split(" ").length + 1;
      })
      .sort((a, b) => a.localeCompare(b));

    for (const child of children) {
      addWithChildren(child);
    }
  }

  // Start with top-level commands in specified order
  for (const topLevel of topLevelPaths) {
    addWithChildren(topLevel);
  }

  // Add any remaining paths (shouldn't happen normally)
  for (const path of commandPaths) {
    if (!visited.has(path)) {
      result.push(path);
    }
  }

  return result;
}

/**
 * Generate file header from FileConfig
 */
function generateFileHeader(fileConfig: FileConfig): string | null {
  if (!fileConfig.title && !fileConfig.description) {
    return null;
  }

  const parts: string[] = [];
  if (fileConfig.title) {
    parts.push(`# ${fileConfig.title}`);
  }
  if (fileConfig.description) {
    parts.push("");
    parts.push(fileConfig.description);
  }
  parts.push("");

  return parts.join("\n");
}

/**
 * Generate markdown for a file containing multiple commands
 */
function generateFileMarkdown(
  commandPaths: string[],
  allCommands: Map<string, CommandInfo>,
  render: RenderFunction,
  filePath?: string,
  fileMap?: Record<string, string>,
  specifiedOrder?: string[],
  fileConfig?: FileConfig,
): string {
  const sections: string[] = [];

  // Add file header if title or description is provided
  const header = fileConfig ? generateFileHeader(fileConfig) : null;
  if (header) {
    sections.push(header);
  }

  // Sort commands depth-first while preserving specified order
  const sortedPaths = sortDepthFirst(commandPaths, specifiedOrder ?? []);

  for (const cmdPath of sortedPaths) {
    const info = allCommands.get(cmdPath);
    if (!info) continue;

    // Add file context to CommandInfo for cross-file link generation
    const infoWithFileContext: CommandInfo = {
      ...info,
      filePath,
      fileMap,
    };

    const renderedSection = render(infoWithFileContext);
    sections.push(renderedSection);
  }

  return sections.join("\n---\n\n");
}

/**
 * Build a map of command path to file path
 */
function buildFileMap(
  files: GenerateDocConfig["files"],
  allCommands: Map<string, CommandInfo>,
  ignores: string[],
): Record<string, string> {
  const fileMap: Record<string, string> = {};

  for (const [filePath, fileConfigRaw] of Object.entries(files)) {
    const fileConfig = normalizeFileConfig(fileConfigRaw);
    const specifiedCommands = fileConfig.commands;

    // Expand to include subcommands
    const expandedCommands = expandCommandPaths(specifiedCommands, allCommands);

    // Filter out ignored commands
    const commandPaths = filterIgnoredCommands(expandedCommands, ignores);

    for (const cmdPath of commandPaths) {
      fileMap[cmdPath] = filePath;
    }
  }

  return fileMap;
}

/**
 * Execute examples for commands based on configuration
 */
async function executeConfiguredExamples(
  allCommands: Map<string, CommandInfo>,
  examplesConfig: ExampleConfig,
  rootCommand: import("../types.js").AnyCommand,
): Promise<void> {
  for (const [cmdPath, cmdConfig] of Object.entries(examplesConfig)) {
    const commandInfo = allCommands.get(cmdPath);
    if (!commandInfo?.examples?.length) {
      continue;
    }

    // Normalize config: true means no mock setup
    const config = cmdConfig === true ? {} : cmdConfig;

    // Parse command path into array
    const commandPath = cmdPath ? cmdPath.split(" ") : [];

    // Execute examples and store results
    const results = await executeExamples(commandInfo.examples, config, rootCommand, commandPath);

    // Update CommandInfo with execution results
    commandInfo.exampleResults = results;
  }
}

/**
 * Generate documentation from command definition
 */
export async function generateDoc(config: GenerateDocConfig): Promise<GenerateDocResult> {
  const { command, files, ignores = [], format = {}, formatter, examples: examplesConfig } = config;
  const updateMode = isUpdateMode();

  // Collect all commands
  const allCommands = await collectAllCommands(command);

  // Execute examples for all commands specified in examplesConfig
  if (examplesConfig) {
    await executeConfiguredExamples(allCommands, examplesConfig, command);
  }

  // Collect all explicitly specified commands from files
  const allFilesCommands: string[] = [];
  for (const fileConfigRaw of Object.values(files)) {
    const fileConfig = normalizeFileConfig(fileConfigRaw);
    allFilesCommands.push(...fileConfig.commands);
  }

  // Validate no conflicts between files and ignores
  validateNoConflicts(allFilesCommands, ignores);

  // Build file map for cross-file links
  const fileMap = buildFileMap(files, allCommands, ignores);

  // Default renderer
  const defaultRenderer = createCommandRenderer(format);

  const results: GenerateDocResult["files"] = [];
  let hasError = false;

  // Process each file
  for (const [filePath, fileConfigRaw] of Object.entries(files)) {
    const fileConfig = normalizeFileConfig(fileConfigRaw);
    const specifiedCommands = fileConfig.commands;

    if (specifiedCommands.length === 0) {
      continue;
    }

    // Expand to include subcommands
    const expandedCommands = expandCommandPaths(specifiedCommands, allCommands);

    // Filter out ignored commands
    const commandPaths = filterIgnoredCommands(expandedCommands, ignores);

    if (commandPaths.length === 0) {
      continue;
    }

    // Use custom renderer if provided, otherwise default
    const render = fileConfig.render ?? defaultRenderer;

    // Generate markdown with file context (pass specifiedCommands as order hint)
    const rawMarkdown = generateFileMarkdown(
      commandPaths,
      allCommands,
      render,
      filePath,
      fileMap,
      specifiedCommands,
      fileConfig,
    );

    // Apply formatter if provided
    const markdown = await applyFormatter(rawMarkdown, formatter);

    // Compare with existing file
    const comparison = compareWithExisting(markdown, filePath);

    if (comparison.match) {
      results.push({
        path: filePath,
        status: "match",
      });
    } else if (updateMode) {
      writeFile(filePath, markdown);
      results.push({
        path: filePath,
        status: comparison.fileExists ? "updated" : "created",
      });
    } else {
      hasError = true;
      results.push({
        path: filePath,
        status: "diff",
        diff: comparison.diff,
      });
    }
  }

  return {
    success: !hasError,
    files: results,
    error: hasError
      ? `Documentation is out of date. Run with ${UPDATE_GOLDEN_ENV}=true to update.`
      : undefined,
  };
}

/**
 * Assert that documentation matches golden files
 * Throws an error if there are differences and update mode is not enabled
 */
export async function assertDocMatch(config: GenerateDocConfig): Promise<void> {
  const result = await generateDoc(config);

  if (!result.success) {
    const diffMessages = result.files
      .filter((f) => f.status === "diff")
      .map((f) => {
        let msg = `File: ${f.path}\n`;
        if (f.diff) {
          msg += f.diff;
        }
        return msg;
      })
      .join("\n\n");

    throw new Error(
      `Documentation does not match golden files.\n\n${diffMessages}\n\n` +
        `Run with ${UPDATE_GOLDEN_ENV}=true to update the documentation.`,
    );
  }
}
