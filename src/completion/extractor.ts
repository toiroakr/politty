/**
 * Extract completion data from commands
 */

import { extractFields, type ResolvedFieldMeta } from "../core/schema-extractor.js";
import { resolveSubCommandMeta } from "../lazy.js";
import type { AnyCommand, ArgsSchema } from "../types.js";
import type {
  CompletableOption,
  CompletablePositional,
  CompletableSubcommand,
  CompletionData,
} from "./types.js";
import { resolveValueCompletion } from "./value-completion-resolver.js";

/**
 * Sanitize a name for use as a shell function/variable identifier.
 * Replaces any character that is not alphanumeric or underscore with underscore.
 *
 * Note: This is not injective -- distinct names may produce the same output
 * (e.g., "foo-bar" and "foo_bar" both become "foo_bar"). When used for nested
 * path encoding (`path.map(sanitize).join("_")`), cross-level collisions are
 * theoretically possible (e.g., "foo-bar:baz" vs "foo:bar-baz") but extremely
 * unlikely in real CLI designs. If collision-safety is needed, sanitize must be
 * replaced with an injective encoding.
 */
export function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Filter subcommands to only visible (non-internal) ones.
 * Internal subcommands start with "__" and are hidden from completion/help.
 */
export function getVisibleSubs(subs: CompletableSubcommand[]): CompletableSubcommand[] {
  return subs.filter((s) => !s.name.startsWith("__"));
}

/**
 * Convert a resolved field to a completable option
 */
function fieldToOption(field: ResolvedFieldMeta): CompletableOption {
  return {
    name: field.name,
    cliName: field.cliName,
    alias: field.alias,
    description: field.description,
    // Booleans are flags that don't require a value
    takesValue: field.type !== "boolean",
    valueType: field.type,
    required: field.required,
    valueCompletion: resolveValueCompletion(field),
  };
}

/**
 * Extract options from a command's args schema
 */
function extractOptions(command: AnyCommand): CompletableOption[] {
  if (!command.args) {
    return [];
  }

  const extracted = extractFields(command.args);
  return extracted.fields
    .filter((field) => !field.positional) // Only include flags/options, not positionals
    .map(fieldToOption);
}

/**
 * Extract positional arguments from a command
 */
export function extractPositionals(command: AnyCommand): ResolvedFieldMeta[] {
  if (!command.args) {
    return [];
  }

  const extracted = extractFields(command.args);
  return extracted.fields.filter((field) => field.positional);
}

/**
 * Extract completable positional arguments from a command
 */
function extractCompletablePositionals(command: AnyCommand): CompletablePositional[] {
  if (!command.args) {
    return [];
  }

  const extracted = extractFields(command.args);
  return extracted.fields
    .filter((field) => field.positional)
    .map((field, index) => ({
      name: field.name,
      cliName: field.cliName,
      position: index,
      description: field.description,
      required: field.required,
      variadic: field.type === "array",
      valueCompletion: resolveValueCompletion(field),
    }));
}

/**
 * Extract a completable subcommand from a command
 */
function extractSubcommand(name: string, command: AnyCommand): CompletableSubcommand {
  const subcommands: CompletableSubcommand[] = [];

  // Extract subcommands recursively (only sync subcommands for now)
  if (command.subCommands) {
    for (const [subName, subCommand] of Object.entries(command.subCommands)) {
      const resolved = resolveSubCommandMeta(subCommand);
      if (resolved) {
        subcommands.push(extractSubcommand(subName, resolved));
      } else {
        // Legacy async subcommands: placeholder only
        subcommands.push({
          name: subName,
          description: "(lazy loaded)",
          subcommands: [],
          options: [],
          positionals: [],
        });
      }
    }
  }

  return {
    name,
    description: command.description,
    subcommands,
    options: extractOptions(command),
    positionals: extractCompletablePositionals(command),
  };
}

/** Join parent and child with a separator, omitting separator when parent is empty. */
function joinPrefix(parent: string, child: string, sep: string): string {
  return parent ? `${parent}${sep}${child}` : child;
}

/**
 * Collect opt-takes-value case entries for a subcommand tree.
 * Used by bash and zsh generators (identical case syntax: `path:--opt) return 0 ;;`).
 * parentPath is a colon-delimited path (e.g., "" for root, "workspace:user" for nested).
 */
export function optTakesValueEntries(sub: CompletableSubcommand, parentPath: string): string[] {
  const lines: string[] = [];
  for (const opt of sub.options) {
    if (opt.takesValue) {
      const patterns: string[] = [`${parentPath}:--${opt.cliName}`];
      if (opt.alias) patterns.push(`${parentPath}:-${opt.alias}`);
      lines.push(`        ${patterns.join("|")}) return 0 ;;`);
    }
  }
  for (const child of getVisibleSubs(sub.subcommands)) {
    lines.push(...optTakesValueEntries(child, joinPrefix(parentPath, child.name, ":")));
  }
  return lines;
}

/**
 * Route entry for subcommand dispatch.
 * - pathStr: colon-delimited path (e.g., "config:user:get")
 * - funcSuffix: sanitized function suffix (e.g., "config_user_get")
 * - lookupPattern: "parentPath:childName" for is_subcmd matching (e.g., "config:user:get", or ":config" for root-level)
 */
export interface RouteEntry {
  pathStr: string;
  funcSuffix: string;
  lookupPattern: string;
}

/**
 * Recursively collect all subcommand route entries.
 * Returns entries used by all shell generators for both dispatch routing
 * and subcommand lookup (is_subcmd) tables.
 */
export function collectRouteEntries(
  sub: CompletableSubcommand,
  parentPath = "",
  parentFunc = "",
): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const child of getVisibleSubs(sub.subcommands)) {
    const pathStr = joinPrefix(parentPath, child.name, ":");
    const funcSuffix = joinPrefix(parentFunc, sanitize(child.name), "_");
    entries.push(...collectRouteEntries(child, pathStr, funcSuffix));
    entries.push({
      pathStr,
      funcSuffix,
      lookupPattern: `${parentPath}:${child.name}`,
    });
  }
  return entries;
}

/**
 * Generate is_subcmd case/switch body lines (bash/zsh case syntax).
 * Returns lines for the case statement body only (caller wraps in function).
 */
export function isSubcmdCaseLines(routeEntries: RouteEntry[]): string[] {
  return routeEntries.map((r) => `        ${r.lookupPattern}) return 0 ;;`);
}

/**
 * Extract completion data from a command tree
 *
 * @param command - The root command
 * @param programName - Program name for completion scripts
 * @param globalArgsSchema - Optional global args schema. When provided, global options
 *   are derived from this schema instead of the root command's options.
 */
export function extractCompletionData(
  command: AnyCommand,
  programName: string,
  globalArgsSchema?: ArgsSchema,
): CompletionData {
  const rootSubcommand = extractSubcommand(programName, command);

  // When globalArgsSchema is provided, derive global options from it
  let globalOptions: CompletableOption[];
  if (globalArgsSchema) {
    const globalExtracted = extractFields(globalArgsSchema);
    globalOptions = globalExtracted.fields.filter((field) => !field.positional).map(fieldToOption);
  } else {
    // Default: global options are the options defined on the root command
    globalOptions = rootSubcommand.options;
  }

  return {
    command: rootSubcommand,
    programName,
    globalOptions,
  };
}
