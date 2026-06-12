import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  extractFields,
  type ExtractedFields,
  type ResolvedFieldMeta,
} from "../core/schema-extractor.js";
import type { AnyCommand, ArgsSchema } from "../types.js";
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
  PathConfig,
  RenderFunction,
  RootDocConfig,
} from "./types.js";
import {
  DOCTOR_ENV,
  globalOptionsEndMarker,
  globalOptionsStartMarker,
  indexEndMarker,
  indexStartMarker,
  rootFooterEndMarker,
  rootFooterStartMarker,
  rootHeaderEndMarker,
  rootHeaderStartMarker,
  SECTION_TYPES,
  sectionEndMarker,
  sectionStartMarker,
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

function isTruthyEnv(envKey: string): boolean {
  const value = process.env[envKey];
  return value === "true" || value === "1";
}

function extractYamlFrontMatter(content: string): string | null {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") {
    return null;
  }

  const frontMatterLines: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === "---" || line === "...") {
      return frontMatterLines.join("\n");
    }
    frontMatterLines.push(line ?? "");
  }

  return null;
}

function stripYamlScalarQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeTemplatePlaceholderKey(value: string): string | null {
  let normalized = stripYamlScalarQuotes(value);
  if (normalized === "") {
    return null;
  }

  const fullPlaceholder = normalized.match(/^\{\{politty:([^{}]*)\}\}$/);
  if (fullPlaceholder) {
    normalized = fullPlaceholder[1] ?? "";
  } else if (normalized.startsWith("politty:")) {
    normalized = normalized.slice("politty:".length);
  }

  return normalized === "" ? null : normalized;
}

function templatePlaceholderKey(placeholder: string): string {
  return placeholder.slice(2, -2).slice("politty:".length);
}

function splitFrontMatterListValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [trimmed];
  }
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function addTemplatePlaceholderExclusion(exclusions: Set<string>, value: string): void {
  const normalized = normalizeTemplatePlaceholderKey(value);
  if (normalized !== null) {
    exclusions.add(normalized);
  }
}

function collectExcludedTemplatePlaceholders(templateContent: string): Set<string> {
  const exclusions = new Set<string>();
  const frontMatter = extractYamlFrontMatter(templateContent);
  if (frontMatter === null) {
    return exclusions;
  }

  let inPolittyBlock = false;
  let inExcludeList = false;
  let excludeIndent = 0;
  for (const line of frontMatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const topLevelPolitty = line.match(/^politty\s*:\s*(.*)$/);
    if (topLevelPolitty) {
      const value = topLevelPolitty[1]?.trim() ?? "";
      inPolittyBlock = value === "";
      inExcludeList = false;
      continue;
    }

    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      inPolittyBlock = false;
      inExcludeList = false;
      continue;
    }

    if (!inPolittyBlock) {
      continue;
    }

    const excludeEntry = line.match(/^(\s+)(?:exclude|excludes)\s*:\s*(.*)$/);
    if (excludeEntry) {
      const value = excludeEntry[2]?.trim() ?? "";
      if (value === "") {
        inExcludeList = true;
        excludeIndent = excludeEntry[1]?.length ?? 0;
      } else {
        inExcludeList = false;
        for (const item of splitFrontMatterListValue(value)) {
          addTemplatePlaceholderExclusion(exclusions, item);
        }
      }
      continue;
    }

    if (!inExcludeList) {
      continue;
    }

    const listItem = line.match(/^(\s*)-\s*(.+)$/);
    if (!listItem || (listItem[1]?.length ?? 0) <= excludeIndent) {
      inExcludeList = false;
      continue;
    }

    addTemplatePlaceholderExclusion(exclusions, listItem[2] ?? "");
  }

  return exclusions;
}

interface TemplateIndexMetadata {
  title?: string;
  description?: string;
}

function collectTemplateIndexMetadata(templateContent: string): TemplateIndexMetadata {
  const frontMatter = extractYamlFrontMatter(templateContent);
  if (frontMatter === null) {
    return {};
  }

  let inPolittyBlock = false;
  let inIndexBlock = false;
  let indexIndent = 0;
  const metadata: TemplateIndexMetadata = {};

  for (const line of frontMatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const topLevelPolitty = line.match(/^politty\s*:\s*(.*)$/);
    if (topLevelPolitty) {
      const value = topLevelPolitty[1]?.trim() ?? "";
      inPolittyBlock = value === "";
      inIndexBlock = false;
      continue;
    }

    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      inPolittyBlock = false;
      inIndexBlock = false;
      continue;
    }

    if (!inPolittyBlock) {
      continue;
    }

    const indexEntry = line.match(/^(\s+)index\s*:\s*(.*)$/);
    if (indexEntry) {
      const value = indexEntry[2]?.trim() ?? "";
      inIndexBlock = value === "";
      indexIndent = indexEntry[1]?.length ?? 0;
      continue;
    }

    if (!inIndexBlock) {
      continue;
    }

    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (indent <= indexIndent) {
      inIndexBlock = false;
      continue;
    }

    const property = line.match(/^\s+(title|description)\s*:\s*(.+)$/);
    if (!property) {
      continue;
    }

    const key = property[1];
    const value = stripYamlScalarQuotes(property[2] ?? "");
    if (key === "title") {
      metadata.title = value;
    } else if (key === "description") {
      metadata.description = value;
    }
  }

  return metadata;
}

interface TemplateExclusions {
  rawKeys: Set<string>;
  commandScopes: Set<string>;
  commandSections: Map<string, Set<SectionType>>;
  globalOptions: boolean;
  index: boolean;
}

function createTemplateExclusions(rawKeys: Set<string>): TemplateExclusions {
  return {
    rawKeys,
    commandScopes: new Set(),
    commandSections: new Map(),
    globalOptions: false,
    index: false,
  };
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
 * Insert a new section marker into existing content at the correct position
 * relative to other section markers for the same command, based on SECTION_TYPES order.
 * Preserves any existing content between adjacent markers by wrapping it with the new markers
 * instead of replacing it with generated content.
 * @throws If no adjacent marker is found (unreachable when at least one marker exists for the command)
 */
function insertSectionMarkerAtOrder(
  content: string,
  type: SectionType,
  scope: string,
  generatedSection: string,
): string {
  const typeIndex = SECTION_TYPES.indexOf(type);
  const startMarker = sectionStartMarker(type, scope);
  const endMarker = sectionEndMarker(type, scope);

  // Find the boundary: end of preceding marker and start of following marker
  let prevBoundary: number | null = null;
  for (let i = typeIndex - 1; i >= 0; i--) {
    const prevType = SECTION_TYPES[i]!;
    const prevEnd = sectionEndMarker(prevType, scope);
    const prevEndIdx = content.indexOf(prevEnd);
    if (prevEndIdx !== -1) {
      prevBoundary = prevEndIdx + prevEnd.length;
      break;
    }
  }

  let nextBoundary: number | null = null;
  for (let i = typeIndex + 1; i < SECTION_TYPES.length; i++) {
    const nextType = SECTION_TYPES[i]!;
    const nextStart = sectionStartMarker(nextType, scope);
    const nextStartIdx = content.indexOf(nextStart);
    if (nextStartIdx !== -1) {
      nextBoundary = nextStartIdx;
      break;
    }
  }

  if (prevBoundary != null && nextBoundary != null) {
    // Both boundaries found: wrap the existing content between them with markers
    // to preserve user customizations
    const between = content.slice(prevBoundary, nextBoundary);
    const innerContent = between.replace(/^\n+/, "\n").replace(/\n+$/, "\n");
    const wrapped = startMarker + innerContent + endMarker;
    return content.slice(0, prevBoundary) + "\n\n" + wrapped + "\n\n" + content.slice(nextBoundary);
  }

  // Only one boundary found: cannot safely determine the current command's content range
  // (wrapping could capture other commands). Insert generated content instead.
  if (prevBoundary != null) {
    let afterPos = prevBoundary;
    while (afterPos < content.length && content[afterPos] === "\n") {
      afterPos++;
    }
    return (
      content.slice(0, prevBoundary) +
      "\n\n" +
      generatedSection +
      (afterPos < content.length ? "\n\n" : "\n") +
      content.slice(afterPos)
    );
  }

  if (nextBoundary != null) {
    let beforePos = nextBoundary;
    while (beforePos > 0 && content[beforePos - 1] === "\n") {
      beforePos--;
    }
    const prefix = beforePos === 0 ? "" : "\n\n";
    return (
      content.slice(0, beforePos) + prefix + generatedSection + "\n\n" + content.slice(nextBoundary)
    );
  }

  throw new Error(
    `No insertion point found for section "${type}" (scope="${scope}"). This should be unreachable when at least one marker exists for the command.`,
  );
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
 * Remove all section markers for a command from content.
 * Returns the content with all markers for the command removed and excess blank lines cleaned up.
 */
function removeCommandSections(content: string, commandPath: string): string {
  const markers = collectSectionMarkers(content, commandPath);
  for (const type of markers) {
    const start = sectionStartMarker(type, commandPath);
    const end = sectionEndMarker(type, commandPath);
    let startIndex = content.indexOf(start);
    while (startIndex !== -1) {
      const endIndex = content.indexOf(end, startIndex);
      if (endIndex === -1) {
        break;
      }
      content = content.slice(0, startIndex) + content.slice(endIndex + end.length);
      startIndex = content.indexOf(start, startIndex);
    }
  }
  // Clean up excess blank lines (3+ consecutive newlines -> 2)
  content = content.replace(/\n{3,}/g, "\n\n");
  return content;
}

/**
 * Strip politty marker lines from content, then collapse the blank-line gaps the removed markers
 * leave behind (outside fenced code blocks only, so intentional blank lines inside generated
 * example/code blocks are preserved) and trim leading/trailing blank lines.
 */
function stripPolittyMarkers(content: string): string {
  const lines = content.split("\n");
  const stripped = lines.filter((line) => !/^<!-- politty:.*-->$/.test(line.trim()));
  let result = collapseBlankLinesOutsideCodeFences(stripped.join("\n"));
  result = result.replace(/^\n+/, "").replace(/\n+$/, "");
  return result;
}

/**
 * Collapse runs of 3+ newlines to 2, but only outside fenced code blocks so that intentional
 * blank lines inside handwritten code samples are preserved. Fences are lines whose trimmed
 * content starts with ``` or ~~~.
 */
function collapseBlankLinesOutsideCodeFences(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let inFence = false;
  let blankRun = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    const isFence = trimmed.startsWith("```") || trimmed.startsWith("~~~");
    if (isFence) {
      inFence = !inFence;
      blankRun = 0;
      out.push(line);
      continue;
    }
    if (!inFence && line.trim() === "") {
      blankRun++;
      // Keep at most one blank line between content outside fences.
      if (blankRun >= 2) {
        continue;
      }
    } else if (!inFence) {
      blankRun = 0;
    }
    out.push(line);
  }
  return out.join("\n");
}

function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function countLineBreaks(value: string): number {
  return (value.match(/\n/g) ?? []).length;
}

/**
 * Type guard for SectionType values parsed from template placeholders.
 */
function isSectionType(value: string): value is SectionType {
  return SECTION_TYPES.some((type) => type === value);
}

/**
 * Clamp a numeric heading level to the valid HeadingLevel range (1–6).
 * Uses a switch to return a literal union member, avoiding `as` assertions.
 */
function clampHeadingLevel(level: number): HeadingLevel {
  const clamped = Math.min(6, Math.max(1, Math.trunc(level)));
  switch (clamped) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
      return 3;
    case 4:
      return 4;
    case 5:
      return 5;
    default:
      return 6;
  }
}

/**
 * Parsed representation of a {{politty:...}} placeholder.
 * Discriminated union; `type` variants are required for unions per project style.
 */
type ParsedPlaceholder =
  | { kind: "command"; scope: string; type: SectionType | undefined }
  | { kind: "global-options" }
  | { kind: "index" }
  | { kind: "invalid"; reason: string };

/**
 * Per-output metadata collected while validating a template.
 */
interface TemplateMeta {
  /** All command scopes referenced by any command placeholder (used for compatibility validation). */
  referencedScopes: string[];
  /**
   * Scopes that produce a command heading in this output, i.e. full-section placeholders
   * (`{{politty:command}}` / `{{politty:command:<scope>}}` without a type). Typed placeholders
   * like `{{politty:command:greet:usage}}` do not emit a `#greet` heading, so they are excluded.
   * Used to build cross-output links and index rows that only point at real anchors.
   */
  headingScopes: string[];
  /** Whether this output emits a `#global-options` anchor via `{{politty:global-options}}`. */
  emitsGlobalOptions: boolean;
  /** Whether this output renders an index from configured outputs via `{{politty:index}}`. */
  emitsIndex: boolean;
  /** Optional title for this output when included in `{{politty:index}}`. */
  indexTitle?: string;
  /** Optional description for this output when included in `{{politty:index}}`. */
  indexDescription?: string;
}

function resolveTemplateCommandScope(
  tokens: string[],
  allCommands: ReadonlyMap<string, CommandInfo> | undefined,
): string | null {
  if (tokens.length === 0) {
    return allCommands === undefined || allCommands.has("") ? "" : null;
  }

  const exactScope = tokens.join(":");
  if (allCommands?.has(exactScope)) {
    return exactScope;
  }

  const colonSeparatedScope = tokens.join(" ");
  if (allCommands?.has(colonSeparatedScope)) {
    return colonSeparatedScope;
  }

  return allCommands === undefined ? colonSeparatedScope : null;
}

function templateScopeFallback(tokens: string[]): string {
  return tokens.join(" ");
}

/**
 * Parse a single {{politty:...}} placeholder string into a discriminated structure.
 * The `placeholder` argument should be the full `{{politty:...}}` text.
 *
 * Uses String.match / String.replace internally (not .exec) to avoid lastIndex
 * state issues from the shared TEMPLATE_PLACEHOLDER_REGEX constant.
 */
function parsePlaceholder(
  placeholder: string,
  allCommands?: ReadonlyMap<string, CommandInfo>,
): ParsedPlaceholder {
  const inner = placeholder.slice(2, -2); // strip {{ and }}
  const tokens = inner.split(":");
  // tokens[0] === "politty"
  const directive = tokens[1];

  if (directive === "command") {
    // tokens after "politty"/"command" form the scope, with an OPTIONAL trailing section type.
    // The public template API separates subcommands with ":" (e.g. config:get). Exact command
    // names that themselves contain ":" still win when present, preserving files-mode parity.
    const rest = tokens.slice(2);
    // {{politty:command:}} — trailing colon with empty scope and no type is ambiguous with the
    // intentional root form {{politty:command}}; treat it as invalid. The typed-root form
    // {{politty:command::usage}} (scope="", type="usage") stays valid.
    if (rest.length === 1 && rest[0] === "") {
      return {
        kind: "invalid",
        reason: `Trailing colon in "${placeholder}"; use {{politty:command}} for the root command.`,
      };
    }

    const fullScope = resolveTemplateCommandScope(rest, allCommands);
    if (fullScope !== null) {
      return { kind: "command", scope: fullScope, type: undefined };
    }

    if (rest.length >= 2) {
      const last = rest[rest.length - 1];
      const scopeTokens = rest.slice(0, -1);
      const sectionScope = resolveTemplateCommandScope(scopeTokens, allCommands);
      if (last !== undefined && isSectionType(last)) {
        return {
          kind: "command",
          scope: sectionScope ?? templateScopeFallback(scopeTokens),
          type: last,
        };
      }
      if (last !== undefined && sectionScope !== null) {
        return {
          kind: "invalid",
          reason: `Unknown section type "${last}" for command scope "${formatCommandPath(sectionScope)}". Valid section types: ${SECTION_TYPES.join(", ")}`,
        };
      }
    }
    return { kind: "command", scope: templateScopeFallback(rest), type: undefined };
  }

  if (directive === "global-options") {
    if (tokens.length !== 2) {
      return {
        kind: "invalid",
        reason: `Malformed placeholder "${placeholder}". Expected {{politty:global-options}}.`,
      };
    }
    return { kind: "global-options" };
  }

  if (directive === "index") {
    if (tokens.length !== 2) {
      return {
        kind: "invalid",
        reason: `Malformed placeholder "${placeholder}". Expected {{politty:index}}.`,
      };
    }
    return { kind: "index" };
  }

  return {
    kind: "invalid",
    reason: `Unknown politty directive "${directive ?? ""}" in "${placeholder}". Valid directives: command, global-options, index`,
  };
}

function buildTemplateExclusions(
  rawKeys: Set<string>,
  allCommands: ReadonlyMap<string, CommandInfo>,
): TemplateExclusions {
  const exclusions = createTemplateExclusions(rawKeys);
  for (const key of rawKeys) {
    const parsed = parsePlaceholder(`{{politty:${key}}}`, allCommands);
    if (parsed.kind === "command") {
      if (parsed.type === undefined) {
        exclusions.commandScopes.add(parsed.scope);
      } else {
        let sections = exclusions.commandSections.get(parsed.scope);
        if (!sections) {
          sections = new Set();
          exclusions.commandSections.set(parsed.scope, sections);
        }
        sections.add(parsed.type);
      }
    } else if (parsed.kind === "global-options") {
      exclusions.globalOptions = true;
    } else if (parsed.kind === "index") {
      exclusions.index = true;
    }
  }
  return exclusions;
}

function isCommandScopeExcluded(
  commandPath: string,
  excludedCommandScopes: ReadonlySet<string>,
): boolean {
  for (const excludedScope of excludedCommandScopes) {
    if (isSubcommandOf(commandPath, excludedScope)) {
      return true;
    }
  }
  return false;
}

function isCommandSectionExcluded(
  commandPath: string,
  sectionType: SectionType,
  exclusions: TemplateExclusions,
): boolean {
  if (isCommandScopeExcluded(commandPath, exclusions.commandScopes)) {
    return true;
  }
  return exclusions.commandSections.get(commandPath)?.has(sectionType) ?? false;
}

function getTemplateCommandTreePaths(
  commandPath: string,
  allCommands: Map<string, CommandInfo>,
  ignores: string[],
  exclusions: TemplateExclusions,
): string[] {
  const expandedPaths = expandCommandPaths([commandPath], allCommands);
  const visiblePaths = filterIgnoredCommands(expandedPaths, ignores).filter(
    (path) => !isCommandScopeExcluded(path, exclusions.commandScopes),
  );
  return sortDepthFirst(visiblePaths, [commandPath]);
}

function shouldSkipTemplatePlaceholder(
  placeholder: string,
  parsed: ParsedPlaceholder,
  exclusions: TemplateExclusions,
): boolean {
  if (exclusions.rawKeys.has(templatePlaceholderKey(placeholder))) {
    return true;
  }

  if (parsed.kind === "command") {
    if (isCommandScopeExcluded(parsed.scope, exclusions.commandScopes)) {
      return true;
    }
    return (
      parsed.type !== undefined &&
      (exclusions.commandSections.get(parsed.scope)?.has(parsed.type) ?? false)
    );
  }

  if (parsed.kind === "global-options") {
    return exclusions.globalOptions;
  }

  if (parsed.kind === "index") {
    return exclusions.index;
  }

  return false;
}

/**
 * Regex matching {{politty:...}} placeholders.
 * NOTE: only use with String.match / String.replace, never with .exec in a loop,
 * because the /g flag makes the regex stateful via lastIndex.
 */
const TEMPLATE_PLACEHOLDER_REGEX = /\{\{politty:[^{}]*\}\}/g;

function validateTemplatePlaceholderSyntax(templateContent: string, templatePath: string): void {
  const validPlaceholderStarts = new Set<number>();
  for (const match of templateContent.matchAll(TEMPLATE_PLACEHOLDER_REGEX)) {
    const start = match.index;
    const end = start + match[0].length;
    if (templateContent[start - 1] === "{" || templateContent[end] === "}") {
      const snippet = templateContent
        .slice(Math.max(0, start - 1), Math.min(templateContent.length, end + 1))
        .split("\n")[0];
      throw new Error(
        `Malformed politty placeholder in template "${templatePath}": "${snippet}". Expected {{politty:...}}.`,
      );
    }
    validPlaceholderStarts.add(start);
  }
  let searchIndex = 0;
  while (true) {
    const placeholderStart = templateContent.indexOf("{{politty:", searchIndex);
    if (placeholderStart === -1) {
      return;
    }
    if (!validPlaceholderStarts.has(placeholderStart)) {
      const snippet = templateContent.slice(placeholderStart, placeholderStart + 80).split("\n")[0];
      throw new Error(
        `Malformed politty placeholder in template "${templatePath}": "${snippet}". Expected {{politty:...}}.`,
      );
    }
    searchIndex = placeholderStart + "{{politty:".length;
  }
}

function getUnknownSectionTypeError(
  scope: string,
  allCommands: Map<string, CommandInfo>,
): string | null {
  const separatorIndex = scope.lastIndexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  const commandScope = scope.slice(0, separatorIndex);
  const sectionType = scope.slice(separatorIndex + 1);
  if (sectionType === "" || !allCommands.has(commandScope)) {
    return null;
  }

  return `Unknown section type "${sectionType}" for command scope "${formatCommandPath(commandScope)}". Valid section types: ${SECTION_TYPES.join(", ")}`;
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
 * Derive an ArgsShape from a globalArgs Zod schema, retaining only non-positional option fields.
 * Returns undefined when globalArgs is undefined or contains no option fields.
 * Used to build globalOptionDefinitions from globalArgs when rootDoc is not available.
 */
function deriveGlobalArgsShape(globalArgs: ArgsSchema | undefined): ArgsShape | undefined {
  if (!globalArgs) return undefined;
  const optionFields = extractFields(globalArgs).fields.filter((f) => !f.positional);
  if (optionFields.length === 0) return undefined;
  return Object.fromEntries(optionFields.map((f) => [f.name, f.schema]));
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
    const fileConfig = Array.isArray(fileConfigRaw) ? undefined : fileConfigRaw;
    categories.push({
      title: fileConfig?.title ?? cmdInfo?.name ?? path.basename(filePath, path.extname(filePath)),
      description: fileConfig?.description ?? cmdInfo?.description ?? "",
      commands: topLevelCommands,
      allowedCommands: commandPaths,
      docPath,
    });
  }
  return categories;
}

/**
 * Build index categories for the {{politty:index}} placeholder from other template outputs.
 * Each category lists exactly the heading-producing scopes of that output (noExpand), so the
 * index never links to commands that template mode did not render.
 */
function deriveIndexFromTemplateOutputs(
  templateMeta: ReadonlyMap<string, TemplateMeta>,
  currentOutputPath: string,
  indexFilePath: string,
  allCommands: Map<string, CommandInfo>,
): CommandCategory[] {
  const normalizedCurrent = normalizeDocPathForComparison(currentOutputPath);
  const categories: CommandCategory[] = [];
  for (const [outputPath, meta] of templateMeta.entries()) {
    if (normalizeDocPathForComparison(outputPath) === normalizedCurrent) continue;
    const scopes = meta.headingScopes;
    if (scopes.length === 0) continue;

    const docPath =
      "./" + path.relative(path.dirname(indexFilePath), outputPath).replace(/\\/g, "/");
    const firstScope = scopes[0];
    const cmdInfo = firstScope !== undefined ? allCommands.get(firstScope) : undefined;
    categories.push({
      title:
        meta.indexTitle ?? cmdInfo?.name ?? path.basename(outputPath, path.extname(outputPath)),
      description: meta.indexDescription ?? cmdInfo?.description ?? "",
      commands: scopes,
      docPath,
      noExpand: true,
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

function commandPathMatchesTarget(commandPath: string, targetCommands: string[]): boolean {
  return targetCommands.some((targetCommand) => isSubcommandOf(commandPath, targetCommand));
}

function templateMetaReferencesCommandTarget(
  meta: TemplateMeta,
  targetCommands: string[],
): boolean {
  return meta.referencedScopes.some((scope) => commandPathMatchesTarget(scope, targetCommands));
}

function templateMetaShouldProcessForTarget(meta: TemplateMeta, targetCommands: string[]): boolean {
  return meta.emitsIndex || templateMetaReferencesCommandTarget(meta, targetCommands);
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
 * Build global options content (anchor + args table) without markers
 */
function buildGlobalOptionsContent(config: {
  args: ArgsShape;
  options?: ArgsTableOptions;
}): string {
  const anchor = '<a id="global-options"></a>';
  const table = renderArgsTable(config.args, config.options);

  return [anchor, table].join("\n");
}

/**
 * Generate global options section content with markers
 */
function generateGlobalOptionsSection(config: {
  args: ArgsShape;
  options?: ArgsTableOptions;
}): string {
  return [
    globalOptionsStartMarker(),
    buildGlobalOptionsContent(config),
    globalOptionsEndMarker(),
  ].join("\n");
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
  autoInsertIfMissing?: boolean,
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
    if (updateMode && autoInsertIfMissing) {
      // Auto-insert markers with generated content (generatedSection already includes markers)
      content = content.trimEnd() + "\n\n" + generatedSection + "\n";
      wasUpdated = true;
      return { content, diffs, hasError, wasUpdated };
    }
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
 * Process a static content marker (root-header or root-footer).
 * Inserts/updates the marker section with the given content.
 */
async function processStaticMarker(
  existingContent: string,
  markerLabel: string,
  startMarker: string,
  endMarker: string,
  rawContent: string,
  updateMode: boolean,
  formatter: FormatterFunction | undefined,
  autoInsertIfMissing: boolean,
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

  const generatedInner = await applyFormatter(rawContent, formatter);
  const generatedSection = [startMarker, generatedInner, endMarker].join("\n");

  const existingSection = extractMarkerSection(content, startMarker, endMarker);

  if (!existingSection) {
    if (updateMode && autoInsertIfMissing) {
      content = content.trimEnd() + "\n\n" + generatedSection + "\n";
      wasUpdated = true;
      return { content, diffs, hasError, wasUpdated };
    }
    hasError = true;
    diffs.push(
      `${markerLabel} marker not found in file. Expected markers:\n${startMarker}\n...\n${endMarker}`,
    );
    return { content, diffs, hasError, wasUpdated };
  }

  if (existingSection !== generatedSection) {
    if (updateMode) {
      const updated = replaceMarkerSection(content, startMarker, endMarker, generatedSection);
      if (updated) {
        content = updated;
        wasUpdated = true;
      } else {
        hasError = true;
        diffs.push(`Failed to replace ${markerLabel} section`);
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

/**
 * Generate a single command section (already contains section markers from renderer)
 */
function generateCommandSection(
  cmdPath: string,
  allCommands: Map<string, CommandInfo>,
  render: RenderFunction,
  filePath?: string,
  fileMap?: Record<string, string>,
  rootDocPath?: string,
  hasGlobalOptions?: boolean,
  ignores: readonly string[] = [],
  excludeOptionNames?: ReadonlySet<string>,
  templateExclusions?: TemplateExclusions,
): string | null {
  const info = allCommands.get(cmdPath);
  if (!info) return null;
  if (
    templateExclusions &&
    isCommandScopeExcluded(info.commandPath, templateExclusions.commandScopes)
  ) {
    return null;
  }

  // Add file context to CommandInfo for cross-file link generation
  const enriched: CommandInfo = { ...info, filePath, fileMap, rootDocPath };
  if (ignores.length > 0 || (templateExclusions && templateExclusions.commandScopes.size > 0)) {
    enriched.subCommands = info.subCommands.filter((sub) => {
      const subCommandPath = sub.fullPath.join(" ");
      if (ignores.some((pattern) => matchesIgnorePattern(subCommandPath, pattern))) {
        return false;
      }
      return !(
        templateExclusions &&
        isCommandScopeExcluded(subCommandPath, templateExclusions.commandScopes)
      );
    });
  }
  if (hasGlobalOptions !== undefined) {
    enriched.hasGlobalOptions = hasGlobalOptions;
  }
  // Non-destructively exclude options (e.g. per-template global options) without mutating
  // the shared CommandInfo in allCommands. The default renderer also reads grouped option
  // tables from `extracted` (union/discriminated-union schemas), so filter those too, otherwise
  // an excluded global option would still appear there and duplicate {{politty:global-options}}.
  if (excludeOptionNames && excludeOptionNames.size > 0) {
    enriched.options = info.options.filter((opt) => !excludeOptionNames.has(opt.name));
    if (info.extracted) {
      enriched.extracted = filterExtractedFields(info.extracted, excludeOptionNames);
    }
  }
  let rendered = render(enriched);
  if (templateExclusions) {
    for (const [scope, sectionTypes] of templateExclusions.commandSections) {
      if (scope !== info.commandPath) {
        continue;
      }
      for (const sectionType of sectionTypes) {
        const section = extractSectionMarker(rendered, sectionType, scope);
        if (section !== null) {
          rendered = rendered.replace(section, "");
        }
      }
      rendered = collapseBlankLinesOutsideCodeFences(rendered);
    }
  }
  return rendered;
}

function generateCommandTreeMarkdown(
  cmdPath: string,
  allCommands: Map<string, CommandInfo>,
  render: RenderFunction,
  ignores: string[],
  filePath: string | undefined,
  fileMap: Record<string, string> | undefined,
  rootDocPath: string | undefined,
  hasGlobalOptions: boolean | undefined,
  excludeOptionNames: ReadonlySet<string> | undefined,
  templateExclusions: TemplateExclusions,
): string | null {
  const commandPaths = getTemplateCommandTreePaths(
    cmdPath,
    allCommands,
    ignores,
    templateExclusions,
  );
  const sections: string[] = [];

  for (const commandPath of commandPaths) {
    const section = generateCommandSection(
      commandPath,
      allCommands,
      render,
      filePath,
      fileMap,
      rootDocPath,
      hasGlobalOptions,
      ignores,
      excludeOptionNames,
      templateExclusions,
    );
    if (section !== null) {
      sections.push(section);
    }
  }

  return sections.length === 0 ? null : sections.join("\n");
}

/**
 * Return a copy of ExtractedFields with the named options removed from every field collection
 * (top-level fields, union options, and discriminated-union variants). Used to exclude global
 * options from grouped option tables rendered directly from `extracted`.
 */
function filterExtractedFields(
  extracted: ExtractedFields,
  excludeOptionNames: ReadonlySet<string>,
): ExtractedFields {
  const result: ExtractedFields = {
    ...extracted,
    fields: extracted.fields.filter((f) => !excludeOptionNames.has(f.name)),
  };
  if (extracted.unionOptions) {
    result.unionOptions = extracted.unionOptions.map((opt) =>
      filterExtractedFields(opt, excludeOptionNames),
    );
  }
  if (extracted.variants) {
    result.variants = extracted.variants.map((variant) => ({
      ...variant,
      fields: variant.fields.filter((f) => !excludeOptionNames.has(f.name)),
    }));
  }
  return result;
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
  rootDocPath?: string,
  hasGlobalOptions?: boolean,
  ignores: string[] = [],
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
    const section = generateCommandSection(
      cmdPath,
      allCommands,
      render,
      filePath,
      fileMap,
      rootDocPath,
      hasGlobalOptions,
      ignores,
    );
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
      files: { [pathConfig]: Array.from(allCommands.keys()) },
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
    // Add the command and all its descendants, skipping already-assigned commands
    for (const existingPath of allCommands.keys()) {
      if (
        (existingPath === cmdPath || existingPath.startsWith(cmdPath + " ")) &&
        !assignedToOtherFiles.has(existingPath)
      ) {
        fc.commands.push(existingPath);
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
  } else if (config.templates !== undefined) {
    files = {};
  } else {
    throw new Error('Either "path", "files", or "templates" must be specified.');
  }

  // Auto-derive rootDoc from PathConfig or globalArgs
  let rootDoc = config.rootDoc;
  if (!rootDoc && usingPathConfig && (globalArgs || config.rootInfo)) {
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
  const doctorMode = isTruthyEnv(DOCTOR_ENV);
  let hasDoctorIssues = false;

  // Validate rootDoc.path does not overlap with files keys (only for explicit files mode)
  if (rootDoc && !usingPathConfig) {
    const normalizedRootDocPath = normalizeDocPathForComparison(rootDoc.path);
    const hasOverlap = Object.keys(files).some(
      (filePath) => normalizeDocPathForComparison(filePath) === normalizedRootDocPath,
    );
    if (hasOverlap) {
      throw new Error(`rootDoc.path "${rootDoc.path}" must not also appear as a key in files.`);
    }
  }

  // Execute examples for all commands specified in examplesConfig
  if (examplesConfig) {
    await executeConfiguredExamples(allCommands, examplesConfig, command);
  }

  const hasTargetCommands = targetCommands !== undefined && targetCommands.length > 0;

  // Collect global option definitions and the initial set of documented command paths (files only).
  // Template scopes will be added after template validation below, before the single
  // validateGlobalOptionCompatibility call and before the mutation that strips global options.
  const globalOptionDefinitions = collectGlobalOptionDefinitions(rootDoc);

  // Global option definitions used to exclude options from command tables WITHIN template
  // outputs that emit a #global-options anchor. Sourced from rootDoc.globalOptions or globalArgs.
  // Unlike globalOptionDefinitions (which drives the destructive global strip for files/rootDoc),
  // these are applied per-output during template generation so plain files outputs are unaffected.
  const templateGlobalOptionFields = new Map<string, ResolvedFieldMeta>();
  if (config.templates) {
    if (globalOptionDefinitions.size > 0) {
      for (const [name, field] of globalOptionDefinitions) {
        templateGlobalOptionFields.set(name, field);
      }
    } else {
      const shape = deriveGlobalArgsShape(globalArgs);
      if (shape) {
        for (const field of collectRenderableGlobalOptionFields(shape)) {
          templateGlobalOptionFields.set(field.name, field);
        }
      }
    }
  }

  const documentedCommandPaths = hasTargetCommands
    ? collectTargetDocumentedCommandPaths(targetCommands, files, allCommands, ignores)
    : collectDocumentedCommandPaths(files, allCommands, ignores);

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
  const templateContents = new Map<string, string | null>();
  const templateExclusions = new Map<string, TemplateExclusions>();
  if (config.templates) {
    for (const [outputPath, templatePath] of Object.entries(config.templates)) {
      const templateContent = readFile(templatePath);
      templateContents.set(outputPath, templateContent);
      if (templateContent !== null) {
        templateExclusions.set(
          outputPath,
          buildTemplateExclusions(
            collectExcludedTemplatePlaceholders(templateContent),
            allCommands,
          ),
        );
      }
    }
  }
  const templateEntries = Object.entries(config.templates ?? {});

  // === Template scope collection (validation pass) ===
  // Parse all templates early — before the files loop — so that template-referenced command scopes
  // can be included in validateGlobalOptionCompatibility and the global-option strip that follow.
  // This ensures a command referenced ONLY via a template is validated against its original
  // (pre-strip) options, closing the vacuous-validation window.
  const templateMeta = new Map<string, TemplateMeta>(); // outputPath -> metadata
  const templateValidationErrors = new Map<string, string[]>();

  if (templateEntries.length > 0) {
    // Upfront validation: path collisions
    const normalizedRootDocPath = rootDoc ? normalizeDocPathForComparison(rootDoc.path) : null;
    const normalizedFileKeys = new Set(Object.keys(files).map(normalizeDocPathForComparison));
    const normalizedTemplateOutputs = new Set<string>();

    // Pre-collect all template output paths so source-vs-output checks can see
    // outputs declared later in the same loop iteration.
    const allNormalizedTemplateOutputs = new Set(
      templateEntries.map(([outputPath]) => normalizeDocPathForComparison(outputPath)),
    );

    for (const [outputPath, templatePath] of templateEntries) {
      const normalizedOutput = normalizeDocPathForComparison(outputPath);
      const normalizedSource = normalizeDocPathForComparison(templatePath);

      if (normalizedFileKeys.has(normalizedOutput)) {
        throw new Error(
          `Template output path "${outputPath}" conflicts with an existing files key.`,
        );
      }
      if (normalizedRootDocPath && normalizedOutput === normalizedRootDocPath) {
        throw new Error(
          `Template output path "${outputPath}" conflicts with rootDoc.path "${rootDoc!.path}".`,
        );
      }
      if (normalizedTemplateOutputs.has(normalizedOutput)) {
        throw new Error(`Duplicate template output path: "${outputPath}".`);
      }
      normalizedTemplateOutputs.add(normalizedOutput);

      if (normalizedSource === normalizedOutput) {
        throw new Error(
          `Template output path "${outputPath}" must not be the same as its source template path.`,
        );
      }

      // Check template SOURCE path against output sets to prevent read-after-write corruption.
      if (normalizedFileKeys.has(normalizedSource)) {
        throw new Error(
          `Template source path "${templatePath}" conflicts with a files output key.`,
        );
      }
      if (normalizedRootDocPath && normalizedSource === normalizedRootDocPath) {
        throw new Error(
          `Template source path "${templatePath}" conflicts with rootDoc.path "${rootDoc!.path}".`,
        );
      }
      if (allNormalizedTemplateOutputs.has(normalizedSource)) {
        throw new Error(
          `Template source path "${templatePath}" conflicts with a template output path.`,
        );
      }
    }

    // Parse templates to collect referencedScopes
    const availableCommandPaths = Array.from(allCommands.keys()).join(", ");

    for (const [outputPath, templatePath] of templateEntries) {
      const templateContent = templateContents.get(outputPath) ?? null;
      const validationErrors: string[] = [];
      if (templateContent === null) {
        // Will be handled in generation loop
        templateMeta.set(outputPath, {
          referencedScopes: [],
          headingScopes: [],
          emitsGlobalOptions: false,
          emitsIndex: false,
        });
        templateValidationErrors.set(outputPath, validationErrors);
        continue;
      }
      try {
        validateTemplatePlaceholderSyntax(templateContent, templatePath);
      } catch (error) {
        validationErrors.push(error instanceof Error ? error.message : String(error));
      }

      const placeholders = Array.from(
        new Set(templateContent.match(TEMPLATE_PLACEHOLDER_REGEX) ?? []),
      );
      const scopes = new Set<string>();
      const headingScopes = new Set<string>();
      let emitsGlobalOptions = false;
      let emitsIndex = false;
      const exclusions = templateExclusions.get(outputPath) ?? createTemplateExclusions(new Set());
      const indexMetadata = collectTemplateIndexMetadata(templateContent);

      for (const placeholder of placeholders) {
        if (exclusions.rawKeys.has(templatePlaceholderKey(placeholder))) {
          continue;
        }

        const parsed = parsePlaceholder(placeholder, allCommands);
        if (shouldSkipTemplatePlaceholder(placeholder, parsed, exclusions)) {
          continue;
        }

        if (parsed.kind === "invalid") {
          validationErrors.push(`${parsed.reason} (in template "${templatePath}")`);
          continue;
        }

        if (parsed.kind === "command") {
          const { scope, type } = parsed;

          if (!allCommands.has(scope)) {
            const sectionTypeError = getUnknownSectionTypeError(scope, allCommands);
            if (sectionTypeError) {
              validationErrors.push(`${sectionTypeError} (in template "${templatePath}")`);
              continue;
            }
            validationErrors.push(
              `Unknown command scope "${scope}" in template "${templatePath}". Available: ${availableCommandPaths}`,
            );
            continue;
          }
          // Validate scope not in ignores
          if (ignores.some((pattern) => matchesIgnorePattern(scope, pattern))) {
            validationErrors.push(
              `Command scope "${scope}" in template "${templatePath}" conflicts with ignores configuration.`,
            );
            continue;
          }
          if (type === undefined) {
            const commandTreePaths = getTemplateCommandTreePaths(
              scope,
              allCommands,
              ignores,
              exclusions,
            );
            for (const commandTreePath of commandTreePaths) {
              scopes.add(commandTreePath);
              if (!isCommandSectionExcluded(commandTreePath, "heading", exclusions)) {
                headingScopes.add(commandTreePath);
              }
            }
          } else {
            // Section type is already constrained to a valid SectionType by parsePlaceholder.
            scopes.add(scope);
            // A scope produces a #anchor heading only via the explicit "heading" section.
            // Other typed placeholders (usage, options, …) emit no heading, so they must not
            // feed cross-output links or index rows.
            if (type === "heading" && !isCommandSectionExcluded(scope, "heading", exclusions)) {
              headingScopes.add(scope);
            }
          }
        } else if (parsed.kind === "global-options") {
          emitsGlobalOptions = true;
        } else if (parsed.kind === "index") {
          emitsIndex = true;
        }
      }

      // Check if global-options is used but not configured
      if (emitsGlobalOptions) {
        const hasGlobalOptionsConfig =
          !!rootDoc?.globalOptions || deriveGlobalArgsShape(globalArgs) !== undefined;
        if (!hasGlobalOptionsConfig) {
          validationErrors.push(
            `Template "${templatePath}" uses {{politty:global-options}} but no global options are configured (neither rootDoc.globalOptions nor globalArgs with non-positional options).`,
          );
        }
      }

      templateMeta.set(outputPath, {
        referencedScopes: Array.from(scopes),
        headingScopes: Array.from(headingScopes),
        emitsGlobalOptions,
        emitsIndex,
        ...(indexMetadata.title !== undefined ? { indexTitle: indexMetadata.title } : {}),
        ...(indexMetadata.description !== undefined
          ? { indexDescription: indexMetadata.description }
          : {}),
      });
      templateValidationErrors.set(outputPath, validationErrors);
    }

    // Extend documentedCommandPaths with template scopes so the single
    // validateGlobalOptionCompatibility call below covers template-only commands too.
    for (const meta of templateMeta.values()) {
      if (hasTargetCommands && !templateMetaShouldProcessForTarget(meta, targetCommands)) {
        continue;
      }
      for (const scope of meta.referencedScopes) {
        documentedCommandPaths.add(scope);
      }
    }
  }

  if (hasTargetCommands) {
    for (const targetCommand of targetCommands) {
      const targetFilePath = findFileForCommand(targetCommand, files, allCommands, ignores);
      const targetTemplatePath = Array.from(templateMeta.values()).some((meta) =>
        templateMetaReferencesCommandTarget(meta, [targetCommand]),
      );
      if (!targetFilePath && !targetTemplatePath) {
        throw new Error(
          `Target command "${targetCommand}" not found in any file or template configuration`,
        );
      }
    }
  }

  const activeTemplateMeta =
    hasTargetCommands && config.templates
      ? new Map(
          Array.from(templateMeta.entries()).filter(([, meta]) =>
            templateMetaShouldProcessForTarget(meta, targetCommands),
          ),
        )
      : templateMeta;

  for (const [outputPath, validationErrors] of templateValidationErrors.entries()) {
    if (validationErrors.length > 0 && activeTemplateMeta.has(outputPath)) {
      throw new Error(validationErrors.join("\n"));
    }
  }

  const templateGlobalOptionsProviderPaths = Array.from(templateMeta.entries())
    .filter(([, meta]) => meta.emitsGlobalOptions)
    .map(([outputPath]) => outputPath);
  const templateGlobalOptionsProviderPath =
    templateGlobalOptionsProviderPaths.length === 1
      ? templateGlobalOptionsProviderPaths[0]
      : undefined;

  // Validate global option compatibility across ALL documented commands (files + template scopes),
  // then strip global options from command option tables. Both steps must happen before the files
  // loop and the template generation loop so that generated sections use the stripped options.
  validateGlobalOptionCompatibility(documentedCommandPaths, allCommands, globalOptionDefinitions);
  // When global options come only from globalArgs (no rootDoc), the destructive strip below does
  // not run, so validate them separately — but ONLY for scopes in templates that actually emit a
  // reachable global-options anchor (where options will be excluded). With a single template
  // provider, every template output can link to that provider.
  if (globalOptionDefinitions.size === 0 && templateGlobalOptionFields.size > 0) {
    const emittingTemplateScopes = new Set<string>();
    for (const meta of activeTemplateMeta.values()) {
      if (!meta.emitsGlobalOptions && templateGlobalOptionsProviderPath === undefined) {
        continue;
      }
      for (const scope of meta.referencedScopes) {
        emittingTemplateScopes.add(scope);
      }
    }
    validateGlobalOptionCompatibility(
      emittingTemplateScopes,
      allCommands,
      templateGlobalOptionFields,
    );
  }
  if (globalOptionDefinitions.size > 0) {
    for (const info of allCommands.values()) {
      info.options = info.options.filter((opt) => !globalOptionDefinitions.has(opt.name));
      if (info.extracted) {
        info.extracted = filterExtractedFields(
          info.extracted,
          new Set(globalOptionDefinitions.keys()),
        );
      }
    }
  }

  // Link map covering both files outputs and template-output headings, so a command rendered in
  // one place can link to its heading rendered in another (in either direction). Only scopes that
  // actually produce a heading in a template output are added. A files output (already in fileMap)
  // takes precedence over template outputs, and the first template wins over later ones, so a
  // command rendered in multiple places gets a stable, order-independent link target rather than
  // being overwritten by whichever output happens to be processed last.
  const templateFileMap: Record<string, string> = { ...fileMap };
  for (const [templateOutputPath, meta] of templateMeta.entries()) {
    for (const scope of meta.headingScopes) {
      if (!Object.prototype.hasOwnProperty.call(templateFileMap, scope)) {
        templateFileMap[scope] = templateOutputPath;
      }
    }
  }

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

    // In PathConfig mode, the rootDoc file has extra content (header, global-options)
    // managed by rootDoc processing. Use marker-based comparison to avoid mismatch.
    const isRootDocFile =
      usingPathConfig &&
      rootDoc &&
      normalizeDocPathForComparison(filePath) === normalizeDocPathForComparison(rootDoc.path);
    const useMarkerBasedComparison = hasTargetCommands || isRootDocFile;

    // Handle partial validation when targetCommands are specified
    // or when the file is the rootDoc in PathConfig mode
    if (useMarkerBasedComparison) {
      // Read existing content once for all target commands in this file
      let existingContent = readFile(filePath);
      // Pre-compute sorted order once per file for insertCommandSections
      const sortedCommandPaths = sortDepthFirst(commandPaths, specifiedCommands);
      const effectiveTargetCommands = hasTargetCommands ? fileTargetCommands : commandPaths;

      for (const targetCommand of effectiveTargetCommands) {
        // Generate only the target command's section
        const rawSection = generateCommandSection(
          targetCommand,
          allCommands,
          render,
          filePath,
          templateFileMap,
          rootDoc?.path,
          globalOptionDefinitions.size > 0,
          ignores,
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
              sortedCommandPaths,
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

          if (!existingSection) {
            continue;
          }

          // Stale section: exists in document but not in generated output — replace with empty markers
          if (!generatedSectionPart) {
            const emptyMarker =
              sectionStartMarker(sectionType, targetCommand) +
              "\n" +
              sectionEndMarker(sectionType, targetCommand);
            if (existingSection !== emptyMarker) {
              if (updateMode) {
                const updated = replaceSectionMarker(
                  existingContent,
                  sectionType,
                  targetCommand,
                  emptyMarker,
                );
                if (!updated) {
                  throw new Error(
                    `Failed to replace stale ${sectionType} section for command "${targetCommand}"`,
                  );
                }
                existingContent = updated.replace(/\n{3,}/g, "\n\n");
                writeFile(filePath, existingContent);
                if (fileStatus !== "created") {
                  fileStatus = "updated";
                }
              } else {
                hasError = true;
                fileStatus = "diff";
                diffs.push(formatDiff(existingSection, emptyMarker));
              }
            }
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

        // Doctor mode: detect and insert missing section markers
        if (doctorMode) {
          const generatedMarkers = collectSectionMarkers(generatedSection, targetCommand);
          const existingMarkerSet = new Set(existingMarkers);

          for (const sectionType of generatedMarkers) {
            if (existingMarkerSet.has(sectionType)) {
              continue;
            }

            const generatedSectionPart = extractSectionMarker(
              generatedSection,
              sectionType,
              targetCommand,
            );
            if (!generatedSectionPart) {
              continue;
            }

            if (updateMode) {
              existingContent = insertSectionMarkerAtOrder(
                existingContent,
                sectionType,
                targetCommand,
                generatedSectionPart,
              );
              writeFile(filePath, existingContent);
              if (fileStatus !== "created") {
                fileStatus = "updated";
              }
            } else {
              hasError = true;
              hasDoctorIssues = true;
              fileStatus = "diff";
              diffs.push(
                `[doctor] Missing section marker "${sectionType}" for command "${formatCommandPath(targetCommand)}". Run with ${DOCTOR_ENV}=true ${UPDATE_GOLDEN_ENV}=true to insert.\n${generatedSectionPart}`,
              );
            }
          }
        }
      }

      // Remove orphaned section markers for commands no longer in this file
      if (existingContent) {
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
            if (fileStatus !== "created") {
              fileStatus = "updated";
            }
          }
        } else {
          for (const markerPath of existingMarkerPaths) {
            if (!commandPathSet.has(markerPath)) {
              hasError = true;
              fileStatus = "diff";
              diffs.push(
                `Found orphaned section markers for deleted command "${formatCommandPath(markerPath)}"`,
              );
            }
          }
        }
      }
    } else {
      // Generate markdown with file context (pass specifiedCommands as order hint).
      // Use templateFileMap so a files output can link to a heading rendered in a template
      // output; with no templates it is identical to fileMap.
      const rawMarkdown = generateFileMarkdown(
        commandPaths,
        allCommands,
        render,
        filePath,
        templateFileMap,
        specifiedCommands,
        fileConfig,
        rootDoc?.path,
        globalOptionDefinitions.size > 0,
        ignores,
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

  // === Template generation ===
  // Global options shape used by {{politty:global-options}} placeholders
  let normalizedTemplateGlobalOptions: { args: ArgsShape; options?: ArgsTableOptions } | undefined;
  if (rootDoc?.globalOptions) {
    normalizedTemplateGlobalOptions = normalizeGlobalOptions(rootDoc.globalOptions);
  } else {
    const shape = deriveGlobalArgsShape(globalArgs);
    if (shape) {
      normalizedTemplateGlobalOptions = { args: shape };
    }
  }

  // Now process each template
  for (const [outputPath, templatePath] of templateEntries) {
    if (!activeTemplateMeta.has(outputPath)) {
      continue;
    }

    const templateContent = templateContents.get(outputPath) ?? null;
    if (templateContent === null) {
      hasError = true;
      results.push({
        path: outputPath,
        status: "diff",
        diff: `Template file not found: ${templatePath}`,
      });
      continue;
    }

    const meta = templateMeta.get(outputPath);
    const templateLineEnding = detectLineEnding(templateContent);

    // Compute heading level adjustment from the scopes that actually render a heading. Typed-only
    // placeholders (which emit no heading) must not skew the depth, matching files-mode behaviour
    // where the shallowest rendered command maps to the configured heading level.
    const headingDepths = (meta?.headingScopes ?? []).map((s) => allCommands.get(s)?.depth ?? 1);
    const minDepth = headingDepths.length > 0 ? Math.min(...headingDepths) : 1;
    const adjustedHeadingLevel = clampHeadingLevel((format?.headingLevel ?? 1) - (minDepth - 1));
    const templateRenderer = createCommandRenderer({
      ...format,
      headingLevel: adjustedHeadingLevel,
    });

    // Global options affect command sections in this output ONLY when this output emits a
    // reachable #global-options anchor, another template output provides one, or a rootDoc
    // provides one. Otherwise, leave command option tables intact and emit no global-options link.
    const outputEmitsGlobalOptions = meta?.emitsGlobalOptions ?? false;
    const globalOptionsReachable =
      (rootDoc !== undefined && globalOptionDefinitions.size > 0) ||
      outputEmitsGlobalOptions ||
      templateGlobalOptionsProviderPath !== undefined;
    const excludeOptionNames =
      globalOptionsReachable && templateGlobalOptionFields.size > 0
        ? new Set(templateGlobalOptionFields.keys())
        : undefined;
    const sectionHasGlobalOptions = excludeOptionNames !== undefined;
    // Prefer this output's own #global-options anchor when it emits one, then fall back to rootDoc
    // or the single template output that provides global options.
    const effectiveRootDocPath = outputEmitsGlobalOptions
      ? outputPath
      : (rootDoc?.path ?? templateGlobalOptionsProviderPath);

    // Parse placeholders and compute replacements (reuse TEMPLATE_PLACEHOLDER_REGEX via .match)
    const placeholders = Array.from(
      new Set(templateContent.match(TEMPLATE_PLACEHOLDER_REGEX) ?? []),
    );
    const replacements = new Map<string, string>();
    const exclusions = templateExclusions.get(outputPath) ?? createTemplateExclusions(new Set());

    for (const placeholder of placeholders) {
      if (exclusions.rawKeys.has(templatePlaceholderKey(placeholder))) {
        replacements.set(placeholder, "");
        continue;
      }

      const parsed = parsePlaceholder(placeholder, allCommands);
      if (shouldSkipTemplatePlaceholder(placeholder, parsed, exclusions)) {
        replacements.set(placeholder, "");
        continue;
      }

      if (parsed.kind === "invalid") {
        // Should have been caught in the validation pass; guard defensively.
        throw new Error(
          `Internal error: unresolved placeholder "${placeholder}" in template "${templatePath}": ${parsed.reason}`,
        );
      }

      if (parsed.kind === "command") {
        const { scope, type } = parsed;

        if (type === undefined) {
          const rawSection = generateCommandTreeMarkdown(
            scope,
            allCommands,
            templateRenderer,
            ignores,
            outputPath,
            templateFileMap,
            effectiveRootDocPath,
            sectionHasGlobalOptions,
            excludeOptionNames,
            exclusions,
          );
          if (rawSection === null) {
            replacements.set(placeholder, "");
            continue;
          }
          replacements.set(placeholder, stripPolittyMarkers(rawSection));
        } else {
          const rawSection = generateCommandSection(
            scope,
            allCommands,
            templateRenderer,
            outputPath,
            templateFileMap,
            effectiveRootDocPath,
            sectionHasGlobalOptions,
            ignores,
            excludeOptionNames,
            exclusions,
          );
          if (rawSection === null) {
            replacements.set(placeholder, "");
            continue;
          }
          // Single section type
          const extracted = extractSectionMarker(rawSection, type, scope);
          replacements.set(placeholder, extracted === null ? "" : stripPolittyMarkers(extracted));
        }
      } else if (parsed.kind === "global-options") {
        if (normalizedTemplateGlobalOptions) {
          replacements.set(placeholder, buildGlobalOptionsContent(normalizedTemplateGlobalOptions));
        } else {
          replacements.set(placeholder, "");
        }
      } else if (parsed.kind === "index") {
        // files-based categories keep their normal leaf-only expansion; template-output
        // categories list exactly their rendered heading scopes (noExpand) so the index never
        // links to commands template mode did not render.
        const categories = [
          ...deriveIndexFromFiles(files, outputPath, allCommands, ignores),
          ...deriveIndexFromTemplateOutputs(templateMeta, outputPath, outputPath, allCommands),
        ];
        const indexContent = await renderCommandIndex(command, categories, rootDoc?.index);
        replacements.set(placeholder, indexContent);
      }
    }

    // Substitute placeholders. Handwritten spacing is preserved verbatim; the ONLY whitespace we
    // touch is the gap an EMPTY own-line placeholder would otherwise leave. For such a placeholder
    // we consume the newlines immediately around it and re-emit a single break that matches the
    // larger of the two surrounding runs (so a blank-line paragraph gap stays a blank line, and a
    // tight single-newline gap stays a single newline — adjacent lines never concatenate).
    let generated = templateContent.replace(
      /((?:\r?\n)*)([ \t]*)(\{\{politty:[^{}]*\}\})([ \t]*)((?:\r?\n)*)/g,
      (
        match,
        leadNl: string,
        leadWs: string,
        placeholder: string,
        trailWs: string,
        trailNl: string,
        offset: number,
        fullString: string,
      ) => {
        const replacement = replacements.get(placeholder);
        if (replacement === undefined) {
          throw new Error(
            `Internal error: unresolved placeholder "${placeholder}" in template "${templatePath}".`,
          );
        }
        const startsLine = leadNl !== "" || offset === 0 || fullString[offset - 1] === "\n";
        const endsLine = trailNl !== "" || offset + match.length === fullString.length;
        const isOwnLine = startsLine && endsLine;
        if (replacement === "" && isOwnLine) {
          // Re-emit one break: the wider of the two surrounding newline runs, capped at a blank
          // line. Empty when the placeholder sat at the very start/end so output does not gain a
          // leading or trailing blank line.
          if (leadNl === "" || trailNl === "") {
            return "";
          }
          const leadBreaks = countLineBreaks(leadNl);
          const trailBreaks = countLineBreaks(trailNl);
          const widest = Math.max(leadBreaks, trailBreaks);
          const lineEnding =
            leadBreaks >= trailBreaks ? detectLineEnding(leadNl) : detectLineEnding(trailNl);
          return widest >= 2 ? lineEnding + lineEnding : widest === 1 ? lineEnding : "";
        }
        // Otherwise restore the exact surrounding whitespace and substitute the content.
        return `${leadNl}${leadWs}${replacement}${trailWs}${trailNl}`;
      },
    );

    // Ensure exactly one trailing newline.
    generated = `${generated.trimEnd()}${templateLineEnding}`;

    // Apply formatter
    generated = await applyFormatter(generated, formatter);

    // Compare and update
    const comparison = compareWithExisting(generated, outputPath);
    let templateStatus: "match" | "created" | "updated" | "diff" = "match";
    let templateDiff: string | undefined;

    if (comparison.match) {
      // stays "match"
    } else if (updateMode) {
      writeFile(outputPath, generated);
      templateStatus = comparison.fileExists ? "updated" : "created";
    } else {
      hasError = true;
      templateStatus = "diff";
      if (comparison.diff) {
        templateDiff = comparison.diff;
      }
    }

    results.push({
      path: outputPath,
      status: templateStatus,
      diff: templateDiff,
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
      // rootInfo overrides command defaults
      const rootInfo = config.rootInfo;
      const rootDocFileConfig: FileHeaderConfig = {
        title: rootInfo?.title ?? command.name,
      };
      if (rootDoc.headingLevel !== undefined) {
        rootDocFileConfig.headingLevel = rootDoc.headingLevel;
      }
      const rootDescription = rootInfo?.description ?? command.description;
      if (rootDescription !== undefined) {
        rootDocFileConfig.description = rootDescription;
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

      // Process rootInfo.header marker (after title/description)
      if (rootInfo?.header) {
        const headerMarkerResult = await processStaticMarker(
          content,
          "Root header",
          rootHeaderStartMarker(),
          rootHeaderEndMarker(),
          rootInfo.header,
          updateMode,
          formatter,
          usingPathConfig,
        );
        content = headerMarkerResult.content;
        rootDocDiffs.push(...headerMarkerResult.diffs);
        if (headerMarkerResult.hasError) {
          hasError = true;
        }
        if (headerMarkerResult.wasUpdated) {
          markerUpdated = true;
        }
      }

      // Detect and clean up unexpected section markers in rootDoc
      // In PathConfig mode, section markers are expected (rootDoc overlaps with files)
      if (!usingPathConfig) {
        const unexpectedSectionPaths = collectSectionMarkerPaths(content);
        if (unexpectedSectionPaths.length > 0) {
          if (updateMode) {
            for (const commandPath of unexpectedSectionPaths) {
              content = removeCommandSections(content, commandPath);
            }
            markerUpdated = true;
          } else {
            hasError = true;
            rootDocDiffs.push(
              `Found unexpected section markers in rootDoc: ${unexpectedSectionPaths
                .map((commandPath) => `"${formatCommandPath(commandPath)}"`)
                .join(", ")}.`,
            );
          }
        }
      }

      // Process global options marker
      const normalizedGlobalOptions = normalizeGlobalOptions(rootDoc.globalOptions);
      if (normalizedGlobalOptions) {
        const globalOptionsResult = await processGlobalOptionsMarker(
          content,
          normalizedGlobalOptions,
          updateMode,
          formatter,
          usingPathConfig,
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
      // Forward slashes keep the marker stable when docs are regenerated on a different OS.
      const indexScope = path.relative(process.cwd(), rootDocFilePath).replace(/\\/g, "/");
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

      // Process rootInfo.footer marker (at end of document)
      if (rootInfo?.footer) {
        const footerMarkerResult = await processStaticMarker(
          content,
          "Root footer",
          rootFooterStartMarker(),
          rootFooterEndMarker(),
          rootInfo.footer,
          updateMode,
          formatter,
          usingPathConfig,
        );
        content = footerMarkerResult.content;
        rootDocDiffs.push(...footerMarkerResult.diffs);
        if (footerMarkerResult.hasError) {
          hasError = true;
        }
        if (footerMarkerResult.wasUpdated) {
          markerUpdated = true;
        }
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

  const errorHint = hasDoctorIssues
    ? `Run with ${DOCTOR_ENV}=true ${UPDATE_GOLDEN_ENV}=true to fix missing markers.`
    : `Run with ${UPDATE_GOLDEN_ENV}=true to update.`;

  return {
    success: !hasError,
    files: results,
    error: hasError ? `Documentation is out of date. ${errorHint}` : undefined,
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
  config: Pick<GenerateDocConfig, "files" | "templates" | "rootDoc"> | string,
  fileSystem?: DeleteFileFs,
): void {
  if (!isTruthyEnv(UPDATE_GOLDEN_ENV)) {
    return;
  }

  if (typeof config === "string") {
    deleteFile(config, fileSystem);
  } else {
    // Never delete a path that is used as a template source. A misconfigured entry whose files
    // output or template output equals some template source (e.g. { [p]: p }) must be left intact
    // so generateDoc can reject it instead of this initializer destroying the source first.
    // Computed up front so it guards BOTH the files loop and the templates loop.
    const protectedPaths = new Set(
      Object.values(config.templates ?? {}).map(normalizeDocPathForComparison),
    );
    if (config.rootDoc) {
      protectedPaths.add(normalizeDocPathForComparison(config.rootDoc.path));
    }
    const isProtectedPath = (p: string): boolean =>
      protectedPaths.has(normalizeDocPathForComparison(p));

    // rootDoc is NOT deleted because generateDoc expects it to exist with markers.
    // Only generated files (which are fully regenerated) are deleted.
    if (config.files) {
      for (const filePath of Object.keys(config.files)) {
        if (isProtectedPath(filePath)) {
          continue;
        }
        deleteFile(filePath, fileSystem);
      }
    }
    if (config.templates) {
      for (const outputPath of Object.keys(config.templates)) {
        if (isProtectedPath(outputPath)) {
          continue;
        }
        deleteFile(outputPath, fileSystem);
      }
    }
  }
}
