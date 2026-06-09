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
import { createCommandMd, createLayoutMd, type CommandMdOptions, type LayoutMd } from "./md-tag.js";
import { renderArgsTable, type ArgsShape, type ArgsTableOptions } from "./render-args.js";
import { renderCommandIndex, type CommandCategory } from "./render-index.js";
import type {
  CommandInfo,
  CommandMap,
  CommandOverride,
  ExampleConfig,
  FileConfig,
  FileMapping,
  FormatterFunction,
  GenerateDocConfig,
  GenerateDocResult,
  HeadingLevel,
  PathConfig,
  RenderFunction,
  RootDocConfig,
} from "./types.js";
import { commandEndMarker, commandStartMarker, UPDATE_GOLDEN_ENV } from "./types.js";

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

function isTruthyEnv(envKey: string): boolean {
  const value = process.env[envKey];
  return value === "true" || value === "1";
}

/** Normalized file configuration produced from any FileMapping value. */
interface NormalizedFileConfig {
  /** Command paths to include in this file. */
  commands: string[];
  /** Per-command overrides (path -> override). */
  commandOverrides: CommandMap;
  /** Optional custom layout. */
  layout?: ((md: LayoutMd) => string) | undefined;
  /** Skip subcommand expansion. */
  noExpand?: boolean | undefined;
}

/**
 * Build the `{ commands, commandOverrides }` pair from a CommandMap.
 * `commands` preserves the map's key insertion order; function values become
 * overrides while `true` values use the default render.
 */
function splitCommandMap(map: CommandMap): { commands: string[]; commandOverrides: CommandMap } {
  const commands = Object.keys(map);
  const commandOverrides: CommandMap = {};
  for (const [cmdPath, override] of Object.entries(map)) {
    if (typeof override === "function") {
      commandOverrides[cmdPath] = override;
    }
  }
  return { commands, commandOverrides };
}

/**
 * Normalize a FileConfig to a NormalizedFileConfig. `commands` is either an
 * array of paths (default render) or a CommandMap (with per-command overrides);
 * the two are distinguished reliably by `Array.isArray`.
 */
function normalizeFileConfig(config: FileConfig): NormalizedFileConfig {
  if (config.commands === undefined && config.layout === undefined) {
    throw new Error(
      "A file config must have `commands` and/or `layout`. " +
        "Wrap per-command overrides in `{ commands: { … } }`.",
    );
  }

  const rawCommands = config.commands;
  let commands: string[] = [];
  let commandOverrides: CommandMap = {};
  if (Array.isArray(rawCommands)) {
    commands = rawCommands;
  } else if (rawCommands) {
    ({ commands, commandOverrides } = splitCommandMap(rawCommands));
  }
  return {
    commands,
    commandOverrides,
    layout: config.layout,
    noExpand: config.noExpand,
  };
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
  fileConfigRaw: FileConfig,
  allCommands: Map<string, CommandInfo>,
  ignores: string[],
): {
  fileConfig: NormalizedFileConfig;
  specifiedCommands: string[];
  commandPaths: string[];
  topLevelCommands: string[];
} {
  const fileConfig = normalizeFileConfig(fileConfigRaw);
  const specifiedCommands = fileConfig.commands;
  const expandedCommands = fileConfig.noExpand
    ? specifiedCommands.filter((p) => allCommands.has(p))
    : expandCommandPaths(specifiedCommands, allCommands);
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

function formatCommandPath(commandPath: string): string {
  return commandPath === "" ? "<root>" : commandPath;
}

// ---------------------------------------------------------------------------
// Single command-marker helpers (over the generic extract/replace below).
// ---------------------------------------------------------------------------

/** Extract a command's wrapped block (including markers), or null. */
function extractCommandMarker(content: string, commandPath: string): string | null {
  return extractMarkerSection(
    content,
    commandStartMarker(commandPath),
    commandEndMarker(commandPath),
  );
}

/** Replace a command's wrapped block. Returns null if the marker is absent. */
function replaceCommandMarker(content: string, commandPath: string, block: string): string | null {
  return replaceMarkerSection(
    content,
    commandStartMarker(commandPath),
    commandEndMarker(commandPath),
    block,
  );
}

/** Whether the content contains a command marker for the given path. */
function hasCommandMarker(content: string, commandPath: string): boolean {
  return content.includes(commandStartMarker(commandPath));
}

/**
 * Collect all command paths that have a command marker in the content.
 */
function collectSectionMarkerPaths(content: string): string[] {
  const markerPattern = /<!--\s*politty:command:(.*?):start\s*-->/g;
  const paths = new Set<string>();
  for (const match of content.matchAll(markerPattern)) {
    paths.add(match[1] ?? "");
  }
  return Array.from(paths);
}

/**
 * Insert a command's wrapped block at the correct position based on the
 * specified order. Uses the next command's start marker as the reference point,
 * falling back to after the previous command's end marker, then to the end.
 */
function insertCommandSections(
  content: string,
  commandPath: string,
  newBlock: string,
  specifiedOrder: string[],
): string {
  const targetIndex = specifiedOrder.indexOf(commandPath);
  if (targetIndex === -1) {
    return content.trimEnd() + "\n\n" + newBlock + "\n";
  }

  // Insert before the next command that already has a marker.
  for (let i = targetIndex + 1; i < specifiedOrder.length; i++) {
    const nextCmd = specifiedOrder[i];
    if (nextCmd === undefined) continue;
    const nextMarker = commandStartMarker(nextCmd);
    const nextIndex = content.indexOf(nextMarker);
    if (nextIndex !== -1) {
      let insertPos = nextIndex;
      while (insertPos > 0 && content[insertPos - 1] === "\n") {
        insertPos--;
      }
      if (insertPos < nextIndex) {
        insertPos++;
      }
      return content.slice(0, insertPos) + newBlock + "\n" + content.slice(nextIndex);
    }
  }

  // Otherwise insert after the previous command's end marker.
  for (let i = targetIndex - 1; i >= 0; i--) {
    const prevCmd = specifiedOrder[i];
    if (prevCmd === undefined) continue;
    const prevEndMarker = commandEndMarker(prevCmd);
    const prevEndIndex = content.indexOf(prevEndMarker);
    if (prevEndIndex !== -1) {
      const insertPos = prevEndIndex + prevEndMarker.length;
      return content.slice(0, insertPos) + "\n" + newBlock + content.slice(insertPos);
    }
  }

  return content.trimEnd() + "\n" + newBlock + "\n";
}

/**
 * Remove a command's marker block from content and clean up blank lines.
 */
function removeCommandSections(content: string, commandPath: string): string {
  const start = commandStartMarker(commandPath);
  const end = commandEndMarker(commandPath);
  let startIndex = content.indexOf(start);
  while (startIndex !== -1) {
    const endIndex = content.indexOf(end, startIndex);
    if (endIndex === -1) {
      break;
    }
    content = content.slice(0, startIndex) + content.slice(endIndex + end.length);
    startIndex = content.indexOf(start, startIndex);
  }
  // Clean up excess blank lines (3+ consecutive newlines -> 2)
  content = content.replace(/\n{3,}/g, "\n\n");
  return content;
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
 * Render the global-options table (markerless), with the preserved anchor.
 */
function renderGlobalOptionsTable(config: { args: ArgsShape; options?: ArgsTableOptions }): string {
  const anchor = '<a id="global-options"></a>';
  const table = renderArgsTable(config.args, config.options);
  return `${anchor}\n${table}`;
}

/**
 * Normalize a doc file path for equivalence checks.
 */
function normalizeDocPathForComparison(filePath: string): string {
  return path.resolve(filePath);
}

/**
 * Find which file contains a specific command
 */
function findFileForCommand(
  commandPath: string,
  files: FileMapping,
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
  files: FileMapping,
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

/** Shared context for rendering a single command's block. */
interface CommandRenderContext {
  allCommands: Map<string, CommandInfo>;
  render: RenderFunction;
  commandOverrides: CommandMap;
  mdOptions: CommandMdOptions;
  filePath?: string | undefined;
  fileMap?: Record<string, string> | undefined;
  rootDocPath?: string | undefined;
  hasGlobalOptions?: boolean | undefined;
}

/**
 * Enrich a command's CommandInfo with file context for cross-file links and
 * global-options link generation. Returns null when the command is unknown.
 */
function enrichCommandInfo(cmdPath: string, ctx: CommandRenderContext): CommandInfo | null {
  const info = ctx.allCommands.get(cmdPath);
  if (!info) return null;
  const enriched: CommandInfo = {
    ...info,
    filePath: ctx.filePath,
    fileMap: ctx.fileMap,
    rootDocPath: ctx.rootDocPath,
  };
  if (ctx.hasGlobalOptions !== undefined) {
    enriched.hasGlobalOptions = ctx.hasGlobalOptions;
  }
  return enriched;
}

/**
 * Render a single command's body (override or default) and wrap it in exactly
 * one command marker pair. Returns null when the command is unknown.
 */
function renderCommandBlock(cmdPath: string, ctx: CommandRenderContext): string | null {
  const enriched = enrichCommandInfo(cmdPath, ctx);
  if (!enriched) return null;

  const override: CommandOverride | undefined = ctx.commandOverrides[cmdPath];
  // `ctx.mdOptions.baseHeadingLevel` is the file's minimum-depth level; the
  // default renderer adds `depth - 1` per command, so mirror that here so an
  // override's `md.h(1)` / `md.sections()` heading matches the default render.
  const mdOptions: CommandMdOptions = {
    ...ctx.mdOptions,
    baseHeadingLevel: (ctx.mdOptions.baseHeadingLevel ?? 1) + (enriched.depth - 1),
  };
  const body =
    typeof override === "function"
      ? override(createCommandMd(enriched, mdOptions))
      : ctx.render(enriched);

  return `${commandStartMarker(cmdPath)}\n${body.trimEnd()}\n${commandEndMarker(cmdPath)}`;
}

/**
 * Render the joined, marker-wrapped command blocks for a file, in depth-first
 * order while preserving the specified order.
 */
function renderFileCommands(
  commandPaths: string[],
  specifiedOrder: string[],
  ctx: CommandRenderContext,
): string {
  const sortedPaths = sortDepthFirst(commandPaths, specifiedOrder);
  const blocks: string[] = [];
  for (const cmdPath of sortedPaths) {
    const block = renderCommandBlock(cmdPath, ctx);
    if (block) {
      blocks.push(block);
    }
  }
  return blocks.join("\n\n");
}

/**
 * Build a map of command path to file path
 */
function buildFileMap(
  files: FileMapping,
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
 * Convert PathConfig to FileMapping with explicit command paths.
 * Uses noExpand to prevent subcommand expansion since paths are pre-resolved.
 */
function pathToFiles(
  pathConfig: PathConfig,
  allCommands: Map<string, CommandInfo>,
): { files: FileMapping; rootDocPath: string } {
  if (typeof pathConfig === "string") {
    // All commands in one file
    return {
      files: { [pathConfig]: { commands: Array.from(allCommands.keys()) } },
      rootDocPath: pathConfig,
    };
  }

  const { root, commands = {} } = pathConfig;
  const files: FileMapping = {};

  // Collect commands explicitly assigned to other files.
  // Sort by specificity (most specific first) so that e.g. 'config get' -> 'get.md'
  // takes priority over 'config' -> 'config.md' for that descendant.
  const assignedToOtherFiles = new Set<string>();
  const sortedEntries = Object.entries(commands).sort(
    ([a], [b]) => b.split(" ").length - a.split(" ").length,
  );

  for (const [cmdPath, filePath] of sortedEntries) {
    if (!files[filePath]) {
      files[filePath] = { commands: [], noExpand: true };
    }
    const fc = files[filePath] as FileConfig;
    const fcCommands = fc.commands as string[];
    // Add the command and all its descendants, skipping already-assigned commands
    for (const existingPath of allCommands.keys()) {
      if (
        (existingPath === cmdPath || existingPath.startsWith(cmdPath + " ")) &&
        !assignedToOtherFiles.has(existingPath)
      ) {
        fcCommands.push(existingPath);
        assignedToOtherFiles.add(existingPath);
      }
    }
  }

  // Remaining commands go to root file
  const rootCommands = Array.from(allCommands.keys()).filter((p) => !assignedToOtherFiles.has(p));
  files[root] = { commands: rootCommands, noExpand: true };

  return { files, rootDocPath: root };
}

/**
 * Generate documentation from command definition
 */
export async function generateDoc(config: GenerateDocConfig): Promise<GenerateDocResult> {
  const {
    command,
    ignores = [],
    format = {},
    formatter,
    examples: examplesConfig,
    targetCommands,
    globalArgs,
  } = config;

  // Collect all commands early (needed for PathConfig conversion)
  const allCommands = await collectAllCommands(command);

  // Resolve files from PathConfig or direct FileMapping
  let files: FileMapping;
  let usingPathConfig = false;
  let resolvedRootDocPath: string | undefined;
  if (config.path !== undefined) {
    if (config.files !== undefined) {
      throw new Error('Cannot specify both "path" and "files". Use one or the other.');
    }
    const converted = pathToFiles(config.path, allCommands);
    files = converted.files;
    resolvedRootDocPath = converted.rootDocPath;
    usingPathConfig = true;
  } else if (config.files !== undefined) {
    files = config.files;
  } else {
    throw new Error('Either "path" or "files" must be specified.');
  }

  // Auto-derive rootDoc from PathConfig or globalArgs
  let rootDoc = config.rootDoc;
  if (!rootDoc && usingPathConfig && globalArgs) {
    rootDoc = { path: resolvedRootDocPath! };
  }

  // Auto-derive rootDoc.globalOptions from globalArgs schema if provided
  if (globalArgs && rootDoc && !rootDoc.globalOptions) {
    const optionFields = extractFields(globalArgs).fields.filter((f) => !f.positional);
    if (optionFields.length > 0) {
      const globalShape: ArgsShape = Object.fromEntries(
        optionFields.map((f) => [f.name, f.schema]),
      );
      rootDoc = { ...rootDoc, globalOptions: globalShape };
    }
  }
  const updateMode = isTruthyEnv(UPDATE_GOLDEN_ENV);

  // The rootDoc file is processed as part of the file loop below. In PathConfig
  // mode it is one of the generated files; in explicit-files mode it is a
  // distinct file (must not overlap with a files key).
  const rootDocPath = rootDoc?.path;
  const rootDocIsFileKey =
    rootDocPath !== undefined &&
    Object.keys(files).some(
      (filePath) =>
        normalizeDocPathForComparison(filePath) === normalizeDocPathForComparison(rootDocPath),
    );

  if (rootDoc && !usingPathConfig && rootDocIsFileKey) {
    throw new Error(`rootDoc.path "${rootDoc.path}" must not also appear as a key in files.`);
  }

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

  // Auto-exclude options defined in global options from command option tables.
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

  // Normalized global options (rootDoc only) — drives the `md.globalOptions` getter.
  const normalizedGlobalOptions = normalizeGlobalOptions(rootDoc?.globalOptions);

  const results: GenerateDocResult["files"] = [];
  let hasError = false;

  // Build the set of files to process. The rootDoc file participates in the
  // loop; if it is not already a files key (explicit-files mode), add it with
  // an empty command set so its layout (header + globalOptions + index) renders.
  const fileEntries: Array<[string, FileConfig]> = Object.entries(files);
  if (rootDocPath !== undefined && !rootDocIsFileKey) {
    fileEntries.push([rootDocPath, { commands: [] }]);
  }

  // Process each file
  for (const [filePath, fileConfigRaw] of fileEntries) {
    const isRootDocFile =
      rootDocPath !== undefined &&
      normalizeDocPathForComparison(filePath) === normalizeDocPathForComparison(rootDocPath);

    const { fileConfig, specifiedCommands, commandPaths } = resolveConfiguredCommandPaths(
      fileConfigRaw,
      allCommands,
      ignores,
    );

    // Non-rootDoc files with no commands are skipped. The rootDoc file is always
    // processed (it may carry only globalOptions/index).
    if (!isRootDocFile && (specifiedCommands.length === 0 || commandPaths.length === 0)) {
      continue;
    }

    // In target mode, skip non-target files entirely (rootDoc is still processed).
    const fileTargetCommands = hasTargetCommands
      ? findTargetCommandsInFile(targetCommands, filePath, files, allCommands, ignores)
      : [];
    if (hasTargetCommands && !isRootDocFile && fileTargetCommands.length === 0) {
      continue;
    }

    let fileStatus: "match" | "created" | "updated" | "diff" = "match";
    const diffs: string[] = [];

    // Calculate minimum depth in this file for relative heading level.
    const minDepth =
      commandPaths.length > 0
        ? Math.min(...commandPaths.map((p) => allCommands.get(p)?.depth ?? 1))
        : 1;

    // Adjust headingLevel so the minimum-depth command gets the configured level.
    const adjustedHeadingLevel = Math.max(
      1,
      (format?.headingLevel ?? 1) - (minDepth - 1),
    ) as HeadingLevel;

    const render = createCommandRenderer({
      ...format,
      headingLevel: adjustedHeadingLevel,
    });

    const mdOptions: CommandMdOptions = {
      baseHeadingLevel: adjustedHeadingLevel,
      ...(format.optionStyle !== undefined ? { optionStyle: format.optionStyle } : {}),
      ...(format.generateAnchors !== undefined ? { generateAnchors: format.generateAnchors } : {}),
      ...(format.includeSubcommandDetails !== undefined
        ? { includeSubcommandDetails: format.includeSubcommandDetails }
        : {}),
    };

    const renderCtx: CommandRenderContext = {
      allCommands,
      render,
      commandOverrides: fileConfig.commandOverrides,
      mdOptions,
      filePath,
      fileMap,
      rootDocPath,
      hasGlobalOptions: globalOptionDefinitions.size > 0,
    };

    // rootDoc-only inputs for the layout `md` tag.
    const globalOptionsMarkdown =
      isRootDocFile && normalizedGlobalOptions
        ? renderGlobalOptionsTable(normalizedGlobalOptions)
        : undefined;
    const indexMarkdown = isRootDocFile
      ? await renderCommandIndex(
          command,
          deriveIndexFromFiles(files, rootDocPath!, allCommands, ignores),
          rootDoc?.index,
        )
      : undefined;

    // Assemble the full file content via the layout (or the default layout).
    // Always end with exactly one trailing newline so formatter newline handling
    // (see applyFormatter) preserves the golden files' trailing newline.
    const assembleBody = (): string => {
      const md = createLayoutMd({
        commands: () => renderFileCommands(commandPaths, specifiedCommands, renderCtx),
        ...(globalOptionsMarkdown !== undefined ? { globalOptions: globalOptionsMarkdown } : {}),
        ...(indexMarkdown !== undefined ? { index: indexMarkdown } : {}),
      });

      const layout = isRootDocFile ? rootDoc?.layout : fileConfig.layout;
      if (layout) {
        return layout(md);
      }

      if (isRootDocFile) {
        // Default root layout: title/description, global options, index, commands.
        const headingPrefix = "#".repeat(rootDoc?.headingLevel ?? 1);
        const title = `${headingPrefix} ${command.name}`;
        const description = command.description ?? "";
        return md`
          ${title}

          ${description}

          ${md.globalOptions}

          ${md.index}

          ${md.commands()}
        `;
      }

      // Default file layout: just the command blocks.
      return md`${md.commands()}`;
    };

    const assembleContent = (): string => `${assembleBody()}\n`;

    if (hasTargetCommands && !isRootDocFile) {
      // ── targetCommands partial mode: replace/insert whole command blocks ──
      let existingContent = readFile(filePath);
      const sortedCommandPaths = sortDepthFirst(commandPaths, specifiedCommands);

      if (!existingContent) {
        if (updateMode) {
          const fullContent = await applyFormatter(assembleContent(), formatter);
          writeFile(filePath, fullContent);
          existingContent = fullContent;
          fileStatus = "created";
        } else {
          hasError = true;
          fileStatus = "diff";
          diffs.push(
            `File does not exist. Target commands cannot be validated. Run with ${UPDATE_GOLDEN_ENV}=true to create.`,
          );
        }
      } else {
        for (const targetCommand of fileTargetCommands) {
          const block = renderCommandBlock(targetCommand, renderCtx);
          if (block === null) {
            throw new Error(`Target command "${targetCommand}" not found in commands`);
          }
          const generatedBlock = await applyFormatter(block, formatter);

          if (hasCommandMarker(existingContent, targetCommand)) {
            const existingBlock = extractCommandMarker(existingContent, targetCommand);
            if (existingBlock !== generatedBlock) {
              if (updateMode) {
                const updated = replaceCommandMarker(
                  existingContent,
                  targetCommand,
                  generatedBlock,
                );
                if (!updated) {
                  throw new Error(`Failed to replace command block for "${targetCommand}"`);
                }
                existingContent = updated;
                writeFile(filePath, existingContent);
                fileStatus = "updated";
              } else {
                hasError = true;
                fileStatus = "diff";
                diffs.push(formatDiff(existingBlock ?? "", generatedBlock));
              }
            }
          } else if (updateMode) {
            existingContent = insertCommandSections(
              existingContent,
              targetCommand,
              generatedBlock,
              sortedCommandPaths,
            );
            writeFile(filePath, existingContent);
            fileStatus = "updated";
          } else {
            // Hard error: old-style or missing markers require a full regeneration.
            hasError = true;
            fileStatus = "diff";
            diffs.push(
              `No command marker found for "${formatCommandPath(targetCommand)}" in "${filePath}". ` +
                `This file predates the single command-marker format. ` +
                `Run a full regeneration with ${UPDATE_GOLDEN_ENV}=true (without targetCommands).`,
            );
          }
        }

        // Remove orphaned command markers for commands no longer in this file.
        const existingMarkerPaths = collectSectionMarkerPaths(existingContent);
        const commandPathSet = new Set(commandPaths);
        if (updateMode) {
          let removedAny = false;
          for (const markerPath of existingMarkerPaths) {
            if (!commandPathSet.has(markerPath)) {
              existingContent = removeCommandSections(existingContent, markerPath);
              removedAny = true;
            }
          }
          if (removedAny) {
            writeFile(filePath, existingContent);
            fileStatus = "updated";
          }
        } else {
          for (const markerPath of existingMarkerPaths) {
            if (!commandPathSet.has(markerPath)) {
              hasError = true;
              fileStatus = "diff";
              diffs.push(
                `Found orphaned command marker for deleted command "${formatCommandPath(markerPath)}"`,
              );
            }
          }
        }
      }
    } else {
      // ── Full mode (and rootDoc in any mode): whole-file generation ──
      const generatedMarkdown = await applyFormatter(assembleContent(), formatter);
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

    if (diffs.length > 0) {
      fileStatus = "diff";
    }

    results.push({
      path: filePath,
      status: fileStatus,
      diff: diffs.length > 0 ? diffs.join("\n\n") : undefined,
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
        (result.error ?? `Run with ${UPDATE_GOLDEN_ENV}=true to update the documentation.`),
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
  if (!isTruthyEnv(UPDATE_GOLDEN_ENV)) {
    return;
  }

  if (typeof config === "string") {
    deleteFile(config, fileSystem);
  } else if (config.files) {
    // rootDoc is NOT deleted because generateDoc expects it to exist with markers.
    // Only generated files (which are fully regenerated) are deleted.
    for (const filePath of Object.keys(config.files)) {
      deleteFile(filePath, fileSystem);
    }
  }
}
