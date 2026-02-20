import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { extractFields, type ResolvedFieldMeta } from "../core/schema-extractor.js";
import type { AnyCommand } from "../types.js";
import { createCommandRenderer } from "./default-renderers.js";
import {
  compareWithExisting,
  deleteFile,
  formatDiff,
  readFile,
  writeFile,
  type DeleteFileFs,
} from "./doc-comparator.js";
import { collectAllCommands } from "./doc-generator.js";
import { executeExamples } from "./example-executor.js";
import { renderArgsTable, type ArgsShape, type ArgsTableOptions } from "./render-args.js";
import { renderCommandIndex, type CommandCategory } from "./render-index.js";
import type {
  CommandIndexOptions,
  CommandInfo,
  ExampleConfig,
  FileConfig,
  FileMapping,
  FormatterFunction,
  GenerateDocConfig,
  GenerateDocResult,
  HeadingLevel,
  RenderFunction,
  RootDocConfig,
} from "./types.js";
import {
  globalOptionsEndMarker,
  globalOptionsStartMarker,
  indexEndMarker,
  indexStartMarker,
  sectionEndMarker,
  sectionStartMarker,
  SECTION_TYPES,
  UPDATE_GOLDEN_ENV,
  type SectionType,
} from "./types.js";

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
  const formatted = await formatter(content);
  // Preserve trailing newline behavior of input
  if (!content.endsWith("\n") && formatted.endsWith("\n")) {
    return formatted.slice(0, -1);
  }
  return formatted;
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
function normalizeFileConfig(config: string[] | FileConfig): FileConfig & { commands: string[] } {
  if (Array.isArray(config)) {
    return { commands: config };
  }
  if (!("commands" in config) || !Array.isArray(config.commands)) {
    throw new Error(
      'Invalid file config: object form must include a "commands" array. Use [] to skip generation intentionally.',
    );
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
 * Check if a pattern contains wildcards
 */
function containsWildcard(pattern: string): boolean {
  return pattern.includes("*");
}

/**
 * Check if a command path matches a wildcard pattern
 * - `*` matches any single command segment
 * - Pattern segments are space-separated
 *
 * @example
 * matchesWildcard("config get", "* *") // true
 * matchesWildcard("config", "* *") // false
 * matchesWildcard("config get", "config *") // true
 * matchesWildcard("greet", "*") // true
 */
function matchesWildcard(path: string, pattern: string): boolean {
  const pathSegments = path === "" ? [] : path.split(" ");
  const patternSegments = pattern === "" ? [] : pattern.split(" ");

  if (pathSegments.length !== patternSegments.length) {
    return false;
  }

  for (let i = 0; i < patternSegments.length; i++) {
    const patternSeg = patternSegments[i]!;
    const pathSeg = pathSegments[i]!;

    if (patternSeg !== "*" && patternSeg !== pathSeg) {
      return false;
    }
  }

  return true;
}

/**
 * Expand a wildcard pattern to matching command paths
 */
function expandWildcardPattern(pattern: string, allCommands: Map<string, CommandInfo>): string[] {
  const matches: string[] = [];

  for (const cmdPath of allCommands.keys()) {
    if (matchesWildcard(cmdPath, pattern)) {
      matches.push(cmdPath);
    }
  }

  return matches;
}

/**
 * Check if a path matches any ignore pattern (with wildcard support)
 * For wildcard patterns, also ignores subcommands of matched commands
 */
function matchesIgnorePattern(path: string, ignorePattern: string): boolean {
  if (containsWildcard(ignorePattern)) {
    // Check if path matches the wildcard pattern exactly
    if (matchesWildcard(path, ignorePattern)) {
      return true;
    }
    // Check if path is a subcommand of any command matching the pattern
    // e.g., "config get" is a subcommand of "config" which matches "*"
    const pathSegments = path === "" ? [] : path.split(" ");
    const patternSegments = ignorePattern === "" ? [] : ignorePattern.split(" ");

    // If path is deeper than pattern, check if prefix matches
    if (pathSegments.length > patternSegments.length) {
      const prefixPath = pathSegments.slice(0, patternSegments.length).join(" ");
      return matchesWildcard(prefixPath, ignorePattern);
    }
    return false;
  }
  // For non-wildcards, use original subcommand logic
  return isSubcommandOf(path, ignorePattern);
}

/**
 * Expand command paths to include all subcommands (with wildcard support)
 */
function expandCommandPaths(
  commandPaths: string[],
  allCommands: Map<string, CommandInfo>,
): string[] {
  const expanded = new Set<string>();

  // Resolve wildcards to concrete command paths
  const resolved = commandPaths.flatMap((cmdPath) =>
    containsWildcard(cmdPath) ? expandWildcardPattern(cmdPath, allCommands) : [cmdPath],
  );

  // Add each resolved command and its subcommands
  for (const cmdPath of resolved) {
    for (const existingPath of allCommands.keys()) {
      if (isSubcommandOf(existingPath, cmdPath)) {
        expanded.add(existingPath);
      }
    }
  }

  return Array.from(expanded);
}

/**
 * Filter out ignored commands (with wildcard support)
 */
function filterIgnoredCommands(commandPaths: string[], ignores: string[]): string[] {
  return commandPaths.filter((path) => {
    return !ignores.some((ignorePattern) => matchesIgnorePattern(path, ignorePattern));
  });
}

/**
 * Resolve wildcards to direct matches without subcommand expansion.
 * Returns the "top-level" commands for use in CommandCategory.commands,
 * where expandCommands in render-index handles subcommand expansion.
 */
function resolveTopLevelCommands(
  specifiedCommands: string[],
  allCommands: Map<string, CommandInfo>,
): string[] {
  const result: string[] = [];
  for (const cmdPath of specifiedCommands) {
    if (containsWildcard(cmdPath)) {
      result.push(...expandWildcardPattern(cmdPath, allCommands));
    } else if (allCommands.has(cmdPath)) {
      result.push(cmdPath);
    }
  }
  return result;
}

/**
 * Resolve file command configuration to concrete command paths.
 * This applies wildcard/subcommand expansion and ignore filtering.
 */
function resolveConfiguredCommandPaths(
  fileConfigRaw: string[] | FileConfig,
  allCommands: Map<string, CommandInfo>,
  ignores: string[],
): {
  fileConfig: FileConfig & { commands: string[] };
  specifiedCommands: string[];
  commandPaths: string[];
  topLevelCommands: string[];
} {
  const fileConfig = normalizeFileConfig(fileConfigRaw);
  const specifiedCommands = fileConfig.commands;
  const expandedCommands = expandCommandPaths(specifiedCommands, allCommands);
  const commandPaths = filterIgnoredCommands(expandedCommands, ignores);
  const topLevelCommands = filterIgnoredCommands(
    resolveTopLevelCommands(specifiedCommands, allCommands),
    ignores,
  );

  return {
    fileConfig,
    specifiedCommands,
    commandPaths,
    topLevelCommands,
  };
}

/**
 * Validate that there are no conflicts between files and ignores (with wildcard support)
 */
function validateNoConflicts(
  filesCommands: string[],
  ignores: string[],
  allCommands: Map<string, CommandInfo>,
): void {
  const conflicts: string[] = [];

  for (const filePattern of filesCommands) {
    // Expand file pattern if it's a wildcard
    const filePaths = containsWildcard(filePattern)
      ? expandWildcardPattern(filePattern, allCommands)
      : [filePattern];

    for (const filePath of filePaths) {
      for (const ignorePattern of ignores) {
        if (containsWildcard(ignorePattern)) {
          // For wildcard ignores, check if file path matches the pattern
          if (matchesWildcard(filePath, ignorePattern)) {
            conflicts.push(`"${filePath}" is both in files and ignored by "${ignorePattern}"`);
          }
        } else {
          // For non-wildcard ignores, use original logic
          if (filePath === ignorePattern || isSubcommandOf(filePath, ignorePattern)) {
            conflicts.push(`"${filePath}" is both in files and ignored by "${ignorePattern}"`);
          }
        }
      }
    }
  }

  if (conflicts.length > 0) {
    throw new Error(`Conflict between files and ignores:\n  - ${conflicts.join("\n  - ")}`);
  }
}

/**
 * Validate that all ignored paths exist in the command tree (with wildcard support)
 */
function validateIgnoresExist(ignores: string[], allCommands: Map<string, CommandInfo>): void {
  const nonExistent: string[] = [];

  for (const ignorePattern of ignores) {
    if (containsWildcard(ignorePattern)) {
      // For wildcard patterns, check if at least one command matches
      const matches = expandWildcardPattern(ignorePattern, allCommands);
      if (matches.length === 0) {
        nonExistent.push(`"${ignorePattern}"`);
      }
    } else {
      // For non-wildcard paths, check exact existence
      if (!allCommands.has(ignorePattern)) {
        nonExistent.push(`"${ignorePattern}"`);
      }
    }
  }

  if (nonExistent.length > 0) {
    throw new Error(`Ignored command paths do not exist: ${nonExistent.join(", ")}`);
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
type FileHeaderConfig = Pick<FileConfig, "title" | "description"> & {
  headingLevel?: HeadingLevel;
};

function generateFileHeader(fileConfig: FileHeaderConfig): string | null {
  if (!fileConfig.title && !fileConfig.description) {
    return null;
  }

  const parts: string[] = [];
  if (fileConfig.title) {
    const heading = "#".repeat(fileConfig.headingLevel ?? 1);
    parts.push(`${heading} ${fileConfig.title}`);
  }
  if (fileConfig.description) {
    parts.push("");
    parts.push(fileConfig.description);
  }
  parts.push("");

  return parts.join("\n");
}

/**
 * Extract a leading file header (title and optional description paragraph)
 */
function extractFileHeader(content: string): string | null {
  if (!/^#{1,6} /.test(content)) {
    return null;
  }

  const titleEnd = content.indexOf("\n");
  if (titleEnd === -1) {
    return content;
  }

  let cursor = titleEnd + 1;

  // Skip an optional blank line between the title and description paragraph.
  if (content[cursor] === "\n") {
    cursor += 1;
  }

  // Consume description paragraph lines until we hit a blank line, heading, or marker.
  while (cursor < content.length) {
    const lineEnd = content.indexOf("\n", cursor);
    const line = lineEnd === -1 ? content.slice(cursor) : content.slice(cursor, lineEnd);

    if (line.length === 0 || /^#{1,6}\s/.test(line) || line.startsWith("<!-- politty:")) {
      break;
    }

    cursor = lineEnd === -1 ? content.length : lineEnd + 1;
  }

  return content.slice(0, cursor);
}

/**
 * Validate and optionally update configured file header
 */
function processFileHeader(
  existingContent: string,
  fileConfig: FileHeaderConfig,
  updateMode: boolean,
): {
  content: string;
  diff?: string;
  hasError: boolean;
  wasUpdated: boolean;
} {
  const generatedHeader = generateFileHeader(fileConfig);
  if (!generatedHeader) {
    return { content: existingContent, hasError: false, wasUpdated: false };
  }

  if (existingContent.startsWith(generatedHeader)) {
    return { content: existingContent, hasError: false, wasUpdated: false };
  }

  const existingHeader = extractFileHeader(existingContent) ?? "";

  if (!updateMode) {
    return {
      content: existingContent,
      diff: formatDiff(existingHeader, generatedHeader),
      hasError: true,
      wasUpdated: false,
    };
  }

  const contentWithoutHeader = existingHeader
    ? existingContent.slice(existingHeader.length)
    : existingContent;
  const normalizedBody = contentWithoutHeader.replace(/^\n+/, "");

  return {
    content: `${generatedHeader}${normalizedBody}`,
    hasError: false,
    wasUpdated: true,
  };
}

function formatCommandPath(commandPath: string): string {
  return commandPath === "" ? "<root>" : commandPath;
}

/**
 * Extract a section marker's content from document content.
 * Returns the content between start and end markers (including markers).
 */
function extractSectionMarker(content: string, type: SectionType, scope: string): string | null {
  const start = sectionStartMarker(type, scope);
  const end = sectionEndMarker(type, scope);
  return extractMarkerSection(content, start, end);
}

/**
 * Replace a section marker's content in document content.
 * Returns updated content, or null if marker not found.
 */
function replaceSectionMarker(
  content: string,
  type: SectionType,
  scope: string,
  newContent: string,
): string | null {
  const start = sectionStartMarker(type, scope);
  const end = sectionEndMarker(type, scope);
  return replaceMarkerSection(content, start, end, newContent);
}

/**
 * Collect all section types that have markers for a given command path.
 */
function collectSectionMarkers(content: string, commandPath: string): SectionType[] {
  const found: SectionType[] = [];
  for (const type of SECTION_TYPES) {
    if (extractSectionMarker(content, type, commandPath) !== null) {
      found.push(type);
    }
  }
  return found;
}

/**
 * Collect all command paths that have any section markers in the content.
 */
function collectSectionMarkerPaths(content: string): string[] {
  // Match any section marker: <!-- politty:command:<scope>:<type>:start -->
  const sectionTypes = SECTION_TYPES.join("|");
  const markerPattern = new RegExp(
    `<!--\\s*politty:command:(.*?):(?:${sectionTypes}):start\\s*-->`,
    "g",
  );
  const paths = new Set<string>();

  for (const match of content.matchAll(markerPattern)) {
    paths.add(match[1] ?? "");
  }

  return Array.from(paths);
}

/**
 * Insert command section markers at the correct position based on specified order.
 * Uses the heading marker of adjacent commands as reference points.
 */
function insertCommandSections(
  content: string,
  commandPath: string,
  newSection: string,
  specifiedOrder: string[],
): string {
  const targetIndex = specifiedOrder.indexOf(commandPath);
  if (targetIndex === -1) {
    return content.trimEnd() + "\n\n" + newSection + "\n";
  }

  // Find the next command's heading marker in the content
  for (let i = targetIndex + 1; i < specifiedOrder.length; i++) {
    const nextCmd = specifiedOrder[i];
    if (nextCmd === undefined) continue;
    const nextMarker = sectionStartMarker("heading", nextCmd);
    const nextIndex = content.indexOf(nextMarker);
    if (nextIndex !== -1) {
      let insertPos = nextIndex;
      while (insertPos > 0 && content[insertPos - 1] === "\n") {
        insertPos--;
      }
      if (insertPos < nextIndex) {
        insertPos++;
      }
      return content.slice(0, insertPos) + newSection + "\n" + content.slice(nextIndex);
    }
  }

  // Find the previous command's last marker in the content
  for (let i = targetIndex - 1; i >= 0; i--) {
    const prevCmd = specifiedOrder[i];
    if (prevCmd === undefined) continue;
    // Find the last section marker for the previous command
    const prevMarkers = collectSectionMarkers(content, prevCmd);
    if (prevMarkers.length > 0) {
      const lastType = prevMarkers[prevMarkers.length - 1]!;
      const prevEndMarker = sectionEndMarker(lastType, prevCmd);
      const prevEndIndex = content.indexOf(prevEndMarker);
      if (prevEndIndex !== -1) {
        const insertPos = prevEndIndex + prevEndMarker.length;
        return content.slice(0, insertPos) + "\n" + newSection + content.slice(insertPos);
      }
    }
  }

  return content.trimEnd() + "\n" + newSection + "\n";
}

/**
 * Extract a marker section from content
 * Returns the content between start and end markers (including markers)
 */
function extractMarkerSection(
  content: string,
  startMarker: string,
  endMarker: string,
): string | null {
  const startIndex = content.indexOf(startMarker);
  if (startIndex === -1) {
    return null;
  }

  const endIndex = content.indexOf(endMarker, startIndex);
  if (endIndex === -1) {
    return null;
  }

  return content.slice(startIndex, endIndex + endMarker.length);
}

/**
 * Replace a marker section in content
 * Returns the updated content with the new section
 */
function replaceMarkerSection(
  content: string,
  startMarker: string,
  endMarker: string,
  newSection: string,
): string | null {
  const startIndex = content.indexOf(startMarker);
  if (startIndex === -1) {
    return null;
  }

  const endIndex = content.indexOf(endMarker, startIndex);
  if (endIndex === -1) {
    return null;
  }

  return content.slice(0, startIndex) + newSection + content.slice(endIndex + endMarker.length);
}

/**
 * Check if config is the { args, options? } shape (not shorthand ArgsShape)
 *
 * Distinguishes between:
 * - { args: ArgsShape, options?: ArgsTableOptions } → returns true
 * - ArgsShape (e.g., { verbose: ZodType, args: ZodType }) → returns false
 *
 * The key insight is that in the { args, options? } shape, config.args is an ArgsShape
 * (Record of ZodTypes), while in shorthand, config itself is the ArgsShape and config.args
 * would be a single ZodType if user has an option named "args".
 */
function isGlobalOptionsConfigWithOptions(
  config: NonNullable<RootDocConfig["globalOptions"]>,
): config is {
  args: ArgsShape;
  options?: ArgsTableOptions;
} {
  if (typeof config !== "object" || config === null || !("args" in config)) {
    return false;
  }
  // If config.args is a ZodType, this is shorthand with an option named "args"
  // If config.args is an object (ArgsShape), this is the { args, options? } shape
  return !(config.args instanceof z.ZodType);
}

/**
 * Collect option fields that are actually rendered by global options markers.
 * Positional args are not rendered in args tables, so they must not be excluded.
 */
function collectRenderableGlobalOptionFields(argsShape: ArgsShape): ResolvedFieldMeta[] {
  const extracted = extractFields(z.object(argsShape));
  return extracted.fields.filter((field) => !field.positional);
}

/**
 * Compare option definitions for global-options compatibility.
 */
function areGlobalOptionsEquivalent(a: ResolvedFieldMeta, b: ResolvedFieldMeta): boolean {
  const { schema: _aSchema, ...aRest } = a;
  const { schema: _bSchema, ...bRest } = b;
  return isDeepStrictEqual(aRest, bRest);
}

/**
 * Normalize rootDoc.globalOptions to { args, options? } form.
 */
function normalizeGlobalOptions(
  config: RootDocConfig["globalOptions"],
): { args: ArgsShape; options?: ArgsTableOptions } | undefined {
  if (!config) return undefined;
  return isGlobalOptionsConfigWithOptions(config) ? config : { args: config };
}

/**
 * Collect global option definitions from rootDoc.
 * Global options are intentionally applied to all generated command sections.
 */
function collectGlobalOptionDefinitions(
  rootDoc: RootDocConfig | undefined,
): Map<string, ResolvedFieldMeta> {
  const globalOptions = new Map<string, ResolvedFieldMeta>();
  if (!rootDoc?.globalOptions) return globalOptions;

  const normalized = normalizeGlobalOptions(rootDoc.globalOptions);
  if (!normalized) return globalOptions;

  for (const field of collectRenderableGlobalOptionFields(normalized.args)) {
    globalOptions.set(field.name, field);
  }

  return globalOptions;
}

/**
 * Derive CommandCategory[] from files mapping.
 * Category title/description come from the first command in each file entry.
 */
function deriveIndexFromFiles(
  files: FileMapping,
  rootDocPath: string,
  allCommands: Map<string, CommandInfo>,
  ignores: string[],
): CommandCategory[] {
  const categories: CommandCategory[] = [];
  for (const [filePath, fileConfigRaw] of Object.entries(files)) {
    const { commandPaths, topLevelCommands } = resolveConfiguredCommandPaths(
      fileConfigRaw,
      allCommands,
      ignores,
    );
    if (commandPaths.length === 0) continue;

    const docPath = "./" + path.relative(path.dirname(rootDocPath), filePath).replace(/\\/g, "/");
    const firstCmdPath = commandPaths[0];
    const cmdInfo = firstCmdPath !== undefined ? allCommands.get(firstCmdPath) : undefined;
    categories.push({
      title: cmdInfo?.name ?? path.basename(filePath, path.extname(filePath)),
      description: cmdInfo?.description ?? "",
      commands: topLevelCommands,
      docPath,
    });
  }
  return categories;
}

/**
 * Collect command paths that are actually documented in configured files.
 */
function collectDocumentedCommandPaths(
  files: FileMapping,
  allCommands: Map<string, CommandInfo>,
  ignores: string[],
): Set<string> {
  const documentedCommandPaths = new Set<string>();

  for (const fileConfigRaw of Object.values(files)) {
    const { commandPaths } = resolveConfiguredCommandPaths(fileConfigRaw, allCommands, ignores);
    for (const commandPath of commandPaths) {
      documentedCommandPaths.add(commandPath);
    }
  }

  return documentedCommandPaths;
}

/**
 * Collect command paths that are targeted in configured files.
 */
function collectTargetDocumentedCommandPaths(
  targetCommands: string[],
  files: FileMapping,
  allCommands: Map<string, CommandInfo>,
  ignores: string[],
): Set<string> {
  const documentedTargetCommandPaths = new Set<string>();

  for (const filePath of Object.keys(files)) {
    const targetCommandsInFile = findTargetCommandsInFile(
      targetCommands,
      filePath,
      files,
      allCommands,
      ignores,
    );

    for (const commandPath of targetCommandsInFile) {
      documentedTargetCommandPaths.add(commandPath);
    }
  }

  return documentedTargetCommandPaths;
}

/**
 * Validate that excluded command options match globalOptions definitions.
 */
function validateGlobalOptionCompatibility(
  documentedCommandPaths: Iterable<string>,
  allCommands: Map<string, CommandInfo>,
  globalOptions: Map<string, ResolvedFieldMeta>,
): void {
  if (globalOptions.size === 0) {
    return;
  }

  const conflicts: string[] = [];

  for (const commandPath of documentedCommandPaths) {
    const info = allCommands.get(commandPath);
    if (!info) {
      continue;
    }

    for (const option of info.options) {
      const globalOption = globalOptions.get(option.name);
      if (!globalOption) {
        continue;
      }

      if (!areGlobalOptionsEquivalent(globalOption, option)) {
        conflicts.push(
          `Command "${formatCommandPath(commandPath)}" option "--${option.cliName}" does not match globalOptions definition for "${option.name}".`,
        );
      }
    }
  }

  if (conflicts.length > 0) {
    throw new Error(`Invalid globalOptions configuration:\n  - ${conflicts.join("\n  - ")}`);
  }
}

/**
 * Generate global options section content with markers
 */
function generateGlobalOptionsSection(config: {
  args: ArgsShape;
  options?: ArgsTableOptions;
}): string {
  const startMarker = globalOptionsStartMarker();
  const endMarker = globalOptionsEndMarker();

  const table = renderArgsTable(config.args, config.options);

  return [startMarker, table, endMarker].join("\n");
}

/**
 * Generate index section content with markers
 */
async function generateIndexSection(
  categories: CommandCategory[],
  command: AnyCommand,
  scope: string,
  options?: CommandIndexOptions,
): Promise<string> {
  const startMarker = indexStartMarker(scope);
  const endMarker = indexEndMarker(scope);

  const indexContent = await renderCommandIndex(command, categories, options);

  return [startMarker, indexContent, endMarker].join("\n");
}

/**
 * Normalize a doc file path for equivalence checks.
 */
function normalizeDocPathForComparison(filePath: string): string {
  return path.resolve(filePath);
}

/**
 * Process global options marker in file content
 * Returns result with updated content and any diffs
 */
async function processGlobalOptionsMarker(
  existingContent: string,
  globalOptionsConfig: { args: ArgsShape; options?: ArgsTableOptions },
  updateMode: boolean,
  formatter: FormatterFunction | undefined,
): Promise<{
  content: string;
  diffs: string[];
  hasError: boolean;
  wasUpdated: boolean;
}> {
  let content = existingContent;
  const diffs: string[] = [];
  let hasError = false;
  let wasUpdated = false;

  const startMarker = globalOptionsStartMarker();
  const endMarker = globalOptionsEndMarker();

  // Generate new section
  const rawSection = generateGlobalOptionsSection(globalOptionsConfig);
  const generatedSection = await applyFormatter(rawSection, formatter);

  // Extract existing section
  const existingSection = extractMarkerSection(content, startMarker, endMarker);

  if (!existingSection) {
    hasError = true;
    diffs.push(
      `Global options marker not found in file. Expected markers:\n${startMarker}\n...\n${endMarker}`,
    );
    return { content, diffs, hasError, wasUpdated };
  }

  // Compare sections
  if (existingSection !== generatedSection) {
    if (updateMode) {
      const updated = replaceMarkerSection(content, startMarker, endMarker, generatedSection);
      if (updated) {
        content = updated;
        wasUpdated = true;
      } else {
        hasError = true;
        diffs.push("Failed to replace global options section");
      }
    } else {
      hasError = true;
      diffs.push(formatDiff(existingSection, generatedSection));
    }
  }

  return { content, diffs, hasError, wasUpdated };
}

/**
 * Process index marker in file content
 * Returns result with updated content and any diffs.
 * If the marker is not present in the file, the section is silently skipped.
 */
async function processIndexMarker(
  existingContent: string,
  categories: CommandCategory[],
  command: AnyCommand,
  scope: string,
  updateMode: boolean,
  formatter: FormatterFunction | undefined,
  indexOptions?: CommandIndexOptions,
): Promise<{
  content: string;
  diffs: string[];
  hasError: boolean;
  wasUpdated: boolean;
}> {
  let content = existingContent;
  const diffs: string[] = [];
  let hasError = false;
  let wasUpdated = false;

  const startMarker = indexStartMarker(scope);
  const endMarker = indexEndMarker(scope);

  const hasStartMarker = content.includes(startMarker);
  const hasEndMarker = content.includes(endMarker);

  // Skip silently only when marker is completely absent
  if (!hasStartMarker && !hasEndMarker) {
    return { content, diffs, hasError, wasUpdated };
  }

  if (!hasStartMarker || !hasEndMarker) {
    hasError = true;
    diffs.push("Index marker section is malformed: both start and end markers are required.");
    return { content, diffs, hasError, wasUpdated };
  }

  // Extract existing section. If extraction fails despite both markers existing,
  // marker placement/order is malformed.
  const existingSection = extractMarkerSection(content, startMarker, endMarker);
  if (!existingSection) {
    hasError = true;
    diffs.push("Index marker section is malformed: start marker must appear before end marker.");
    return { content, diffs, hasError, wasUpdated };
  }

  // Generate new section
  const rawSection = await generateIndexSection(categories, command, scope, indexOptions);
  const generatedSection = await applyFormatter(rawSection, formatter);

  // Compare sections
  if (existingSection !== generatedSection) {
    if (updateMode) {
      const updated = replaceMarkerSection(content, startMarker, endMarker, generatedSection);
      if (updated) {
        content = updated;
        wasUpdated = true;
      } else {
        hasError = true;
        diffs.push("Failed to replace index section");
      }
    } else {
      hasError = true;
      diffs.push(formatDiff(existingSection, generatedSection));
    }
  }

  return { content, diffs, hasError, wasUpdated };
}

/**
 * Find which file contains a specific command
 */
function findFileForCommand(
  commandPath: string,
  files: GenerateDocConfig["files"],
  allCommands: Map<string, CommandInfo>,
  ignores: string[],
): string | null {
  for (const [filePath, fileConfigRaw] of Object.entries(files)) {
    const { commandPaths } = resolveConfiguredCommandPaths(fileConfigRaw, allCommands, ignores);

    if (commandPaths.includes(commandPath)) {
      return filePath;
    }
  }
  return null;
}

/**
 * Find which target commands are contained in a file
 * Also expands each target command to include subcommands that are NOT explicitly in specifiedCommands
 */
function findTargetCommandsInFile(
  targetCommands: string[],
  filePath: string,
  files: GenerateDocConfig["files"],
  allCommands: Map<string, CommandInfo>,
  ignores: string[],
): string[] {
  const fileConfigRaw = files[filePath];
  if (!fileConfigRaw) return [];

  const { specifiedCommands, commandPaths } = resolveConfiguredCommandPaths(
    fileConfigRaw,
    allCommands,
    ignores,
  );

  // Expand targetCommands to include their subcommands,
  // but exclude subcommands that are explicitly in specifiedCommands
  const expandedTargets = new Set<string>();
  for (const targetCmd of targetCommands) {
    if (!commandPaths.includes(targetCmd)) continue;

    // Add the target command itself
    expandedTargets.add(targetCmd);

    // Add subcommands that are NOT explicitly specified
    for (const cmdPath of commandPaths) {
      if (isSubcommandOf(cmdPath, targetCmd) && !specifiedCommands.includes(cmdPath)) {
        expandedTargets.add(cmdPath);
      }
    }
  }

  return Array.from(expandedTargets);
}

/**
 * Generate a single command section (already contains section markers from renderer)
 */
function generateCommandSection(
  cmdPath: string,
  allCommands: Map<string, CommandInfo>,
  render: RenderFunction,
  filePath?: string,
  fileMap?: Record<string, string>,
): string | null {
  const info = allCommands.get(cmdPath);
  if (!info) return null;

  // Add file context to CommandInfo for cross-file link generation
  const infoWithFileContext: CommandInfo = {
    ...info,
    filePath,
    fileMap,
  };

  return render(infoWithFileContext);
}

/**
 * Generate markdown for a file containing multiple commands
 * Each command section is wrapped with markers for partial validation
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
    const section = generateCommandSection(cmdPath, allCommands, render, filePath, fileMap);
    if (section) {
      sections.push(section);
    }
  }

  return `${sections.join("\n")}\n`;
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
    const { commandPaths } = resolveConfiguredCommandPaths(fileConfigRaw, allCommands, ignores);

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
  rootCommand: AnyCommand,
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
  const {
    command,
    rootDoc,
    files,
    ignores = [],
    format = {},
    formatter,
    examples: examplesConfig,
    targetCommands,
  } = config;
  const updateMode = isUpdateMode();

  // Validate rootDoc.path does not overlap with files keys
  if (rootDoc) {
    const normalizedRootDocPath = normalizeDocPathForComparison(rootDoc.path);
    const hasOverlap = Object.keys(files).some(
      (filePath) => normalizeDocPathForComparison(filePath) === normalizedRootDocPath,
    );
    if (hasOverlap) {
      throw new Error(`rootDoc.path "${rootDoc.path}" must not also appear as a key in files.`);
    }
  }

  // Collect all commands
  const allCommands = await collectAllCommands(command);

  // Execute examples for all commands specified in examplesConfig
  if (examplesConfig) {
    await executeConfiguredExamples(allCommands, examplesConfig, command);
  }

  const hasTargetCommands = targetCommands !== undefined && targetCommands.length > 0;

  // Validate all targetCommands exist in files
  if (hasTargetCommands) {
    for (const targetCommand of targetCommands) {
      const targetFilePath = findFileForCommand(targetCommand, files, allCommands, ignores);
      if (!targetFilePath) {
        throw new Error(`Target command "${targetCommand}" not found in any file configuration`);
      }
    }
  }

  // Auto-exclude options defined in global options markers from command option tables.
  // These exclusions are intentionally global.
  const globalOptionDefinitions = collectGlobalOptionDefinitions(rootDoc);
  const documentedCommandPaths = hasTargetCommands
    ? collectTargetDocumentedCommandPaths(targetCommands, files, allCommands, ignores)
    : collectDocumentedCommandPaths(files, allCommands, ignores);
  validateGlobalOptionCompatibility(documentedCommandPaths, allCommands, globalOptionDefinitions);

  if (globalOptionDefinitions.size > 0) {
    for (const info of allCommands.values()) {
      info.options = info.options.filter((opt) => !globalOptionDefinitions.has(opt.name));
    }
  }

  // Collect all explicitly specified commands from files
  const allFilesCommands: string[] = [];
  for (const fileConfigRaw of Object.values(files)) {
    const fileConfig = normalizeFileConfig(fileConfigRaw);
    allFilesCommands.push(...fileConfig.commands);
  }

  // Validate ignores refer to existing commands
  validateIgnoresExist(ignores, allCommands);

  // Validate no conflicts between files and ignores
  validateNoConflicts(allFilesCommands, ignores, allCommands);

  // Build file map for cross-file links
  const fileMap = buildFileMap(files, allCommands, ignores);

  const results: GenerateDocResult["files"] = [];
  let hasError = false;

  // Process each file
  for (const [filePath, fileConfigRaw] of Object.entries(files)) {
    const { fileConfig, specifiedCommands, commandPaths } = resolveConfiguredCommandPaths(
      fileConfigRaw,
      allCommands,
      ignores,
    );

    if (specifiedCommands.length === 0) {
      continue;
    }

    // Skip files where no commands resolved
    if (commandPaths.length === 0) {
      continue;
    }

    // In target mode, skip non-target files entirely
    const fileTargetCommands = hasTargetCommands
      ? findTargetCommandsInFile(targetCommands, filePath, files, allCommands, ignores)
      : [];
    if (hasTargetCommands && fileTargetCommands.length === 0) {
      continue;
    }

    let fileStatus: "match" | "created" | "updated" | "diff" = "match";
    const diffs: string[] = [];

    // Calculate minimum depth in this file for relative heading level
    const minDepth = Math.min(...commandPaths.map((p) => allCommands.get(p)?.depth ?? 1));

    // Adjust headingLevel so that minimum depth command gets the configured headingLevel
    const adjustedHeadingLevel = Math.max(
      1,
      (format?.headingLevel ?? 1) - (minDepth - 1),
    ) as HeadingLevel;

    // Create file-specific renderer with adjusted headingLevel (if no custom renderer)
    const fileRenderer = createCommandRenderer({
      ...format,
      headingLevel: adjustedHeadingLevel,
    });

    // Use custom renderer if provided, otherwise use file-specific renderer
    const render = fileConfig.render ?? fileRenderer;

    // Handle partial validation when targetCommands are specified
    if (hasTargetCommands) {
      // Read existing content once for all target commands in this file
      let existingContent = readFile(filePath);

      for (const targetCommand of fileTargetCommands) {
        // Generate only the target command's section
        const rawSection = generateCommandSection(
          targetCommand,
          allCommands,
          render,
          filePath,
          fileMap,
        );

        if (!rawSection) {
          throw new Error(`Target command "${targetCommand}" not found in commands`);
        }

        // Apply formatter to the section
        const generatedSection = await applyFormatter(rawSection, formatter);

        if (!existingContent) {
          // File doesn't exist yet, create it with the section only
          if (updateMode) {
            // For root command, include file header if configured
            const isRootCommand = targetCommand === "";
            const header = isRootCommand && fileConfig ? generateFileHeader(fileConfig) : null;
            const fullContent = header ? `${header}\n${generatedSection}` : generatedSection;
            writeFile(filePath, fullContent);
            existingContent = fullContent;
            fileStatus = "created";
          } else {
            hasError = true;
            fileStatus = "diff";
            diffs.push(
              `File does not exist. Target command "${targetCommand}" section cannot be validated.`,
            );
          }
          continue;
        }

        // Check which section markers exist for this command in the existing content
        const existingMarkers = collectSectionMarkers(existingContent, targetCommand);

        if (existingMarkers.length === 0) {
          // No markers found — insert full template
          if (updateMode) {
            existingContent = insertCommandSections(
              existingContent,
              targetCommand,
              generatedSection,
              specifiedCommands,
            );
            writeFile(filePath, existingContent);
            if (fileStatus !== "created") {
              fileStatus = "updated";
            }
          } else {
            hasError = true;
            fileStatus = "diff";
            diffs.push(
              `Existing file does not contain section markers for command "${targetCommand}"`,
            );
          }
          continue;
        }

        // Validate/update only existing section markers
        for (const sectionType of existingMarkers) {
          const existingSection = extractSectionMarker(existingContent, sectionType, targetCommand);
          const generatedSectionPart = extractSectionMarker(
            generatedSection,
            sectionType,
            targetCommand,
          );

          if (!existingSection || !generatedSectionPart) {
            continue;
          }

          if (existingSection !== generatedSectionPart) {
            if (updateMode) {
              const updated = replaceSectionMarker(
                existingContent,
                sectionType,
                targetCommand,
                generatedSectionPart,
              );
              if (updated) {
                existingContent = updated;
                writeFile(filePath, existingContent);
                if (fileStatus !== "created") {
                  fileStatus = "updated";
                }
              } else {
                throw new Error(
                  `Failed to replace ${sectionType} section for command "${targetCommand}"`,
                );
              }
            } else {
              hasError = true;
              fileStatus = "diff";
              diffs.push(formatDiff(existingSection, generatedSectionPart));
            }
          }
        }
      }
    } else {
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
      const generatedMarkdown = await applyFormatter(rawMarkdown, formatter);
      // Full file comparison (original behavior)
      const comparison = compareWithExisting(generatedMarkdown, filePath);

      if (comparison.match) {
        // fileStatus stays "match"
      } else if (updateMode) {
        writeFile(filePath, generatedMarkdown);
        fileStatus = comparison.fileExists ? "updated" : "created";
      } else {
        hasError = true;
        fileStatus = "diff";
        if (comparison.diff) {
          diffs.push(comparison.diff);
        }
      }
    }

    // Determine final status based on diffs
    if (diffs.length > 0) {
      fileStatus = "diff";
    }

    results.push({
      path: filePath,
      status: fileStatus,
      diff: diffs.length > 0 ? diffs.join("\n\n") : undefined,
    });
  }

  // === Root document processing ===
  if (rootDoc) {
    const rootDocFilePath = rootDoc.path;
    let rootDocStatus: "match" | "created" | "updated" | "diff" = "match";
    const rootDocDiffs: string[] = [];

    const existingContent = readFile(rootDocFilePath);
    if (existingContent === null) {
      hasError = true;
      rootDocStatus = "diff";
      rootDocDiffs.push("File does not exist. Cannot validate rootDoc markers.");
    } else {
      let content = existingContent;
      let markerUpdated = false;

      // Validate/update rootDoc file header derived from command.name/description
      const rootDocFileConfig: FileHeaderConfig = { title: command.name };
      if (rootDoc.headingLevel !== undefined) {
        rootDocFileConfig.headingLevel = rootDoc.headingLevel;
      }
      if (command.description !== undefined) {
        rootDocFileConfig.description = command.description;
      }
      const headerResult = processFileHeader(content, rootDocFileConfig, updateMode);
      content = headerResult.content;
      if (headerResult.diff) {
        rootDocDiffs.push(headerResult.diff);
      }
      if (headerResult.hasError) {
        hasError = true;
      }
      if (headerResult.wasUpdated) {
        markerUpdated = true;
      }

      // Detect unexpected section markers in rootDoc
      const unexpectedSectionPaths = Array.from(new Set(collectSectionMarkerPaths(content)));
      if (unexpectedSectionPaths.length > 0) {
        hasError = true;
        rootDocDiffs.push(
          `Found unexpected section markers in rootDoc: ${unexpectedSectionPaths
            .map((commandPath) => `"${formatCommandPath(commandPath)}"`)
            .join(", ")}.`,
        );
      }

      // Process global options marker
      const normalizedGlobalOptions = normalizeGlobalOptions(rootDoc.globalOptions);
      if (normalizedGlobalOptions) {
        const globalOptionsResult = await processGlobalOptionsMarker(
          content,
          normalizedGlobalOptions,
          updateMode,
          formatter,
        );
        content = globalOptionsResult.content;
        rootDocDiffs.push(...globalOptionsResult.diffs);
        if (globalOptionsResult.hasError) {
          hasError = true;
        }
        if (globalOptionsResult.wasUpdated) {
          markerUpdated = true;
        }
      }

      // Process index marker (auto-derived from files)
      const derivedCategories = deriveIndexFromFiles(files, rootDocFilePath, allCommands, ignores);
      const indexScope = path.relative(process.cwd(), rootDocFilePath);
      const indexResult = await processIndexMarker(
        content,
        derivedCategories,
        command,
        indexScope,
        updateMode,
        formatter,
        rootDoc.index,
      );
      content = indexResult.content;
      rootDocDiffs.push(...indexResult.diffs);
      if (indexResult.hasError) {
        hasError = true;
      }
      if (indexResult.wasUpdated) {
        markerUpdated = true;
      }

      // Write updated content if markers were modified
      if (updateMode && markerUpdated) {
        writeFile(rootDocFilePath, content);
        if (rootDocStatus === "match") {
          rootDocStatus = "updated";
        }
      }
    }

    // Determine final status based on diffs
    if (rootDocDiffs.length > 0) {
      rootDocStatus = "diff";
    }

    results.push({
      path: rootDocFilePath,
      status: rootDocStatus,
      diff: rootDocDiffs.length > 0 ? rootDocDiffs.join("\n\n") : undefined,
    });
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

/**
 * Initialize documentation files by deleting them
 * Only deletes when update mode is enabled (POLITTY_DOCS_UPDATE=true)
 * Use this in beforeAll to ensure skipped tests don't leave stale sections
 * @param config - Config containing files to initialize, or a single file path
 * @param fileSystem - Optional fs implementation (useful when fs is mocked)
 */
export function initDocFile(
  config: Pick<GenerateDocConfig, "files"> | string,
  fileSystem?: DeleteFileFs,
): void {
  if (!isUpdateMode()) {
    return;
  }

  if (typeof config === "string") {
    deleteFile(config, fileSystem);
  } else {
    // rootDoc is NOT deleted because generateDoc expects it to exist with markers.
    // Only generated files (which are fully regenerated) are deleted.
    for (const filePath of Object.keys(config.files)) {
      deleteFile(filePath, fileSystem);
    }
  }
}
