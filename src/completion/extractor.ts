/**
 * Extract completion data from commands
 */

import { extractFields, type ResolvedFieldMeta } from "../core/schema-extractor.js";
import type { AnyCommand } from "../types.js";
import type { CompletableOption, CompletableSubcommand, CompletionData } from "./types.js";

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
 * Extract a completable subcommand from a command
 */
function extractSubcommand(name: string, command: AnyCommand): CompletableSubcommand {
  const subcommands: CompletableSubcommand[] = [];

  // Extract subcommands recursively (only sync subcommands for now)
  if (command.subCommands) {
    for (const [subName, subCommand] of Object.entries(command.subCommands)) {
      // Skip async subcommands as we can't inspect them statically
      if (typeof subCommand === "function") {
        // For async subcommands, add a placeholder
        subcommands.push({
          name: subName,
          description: "(lazy loaded)",
          subcommands: [],
          options: [],
        });
      } else {
        subcommands.push(extractSubcommand(subName, subCommand));
      }
    }
  }

  return {
    name,
    description: command.description,
    subcommands,
    options: extractOptions(command),
  };
}

/**
 * Extract completion data from a command tree
 */
export function extractCompletionData(command: AnyCommand, programName: string): CompletionData {
  const rootSubcommand = extractSubcommand(programName, command);

  return {
    command: rootSubcommand,
    programName,
    // Global options are the options defined on the root command
    globalOptions: rootSubcommand.options,
  };
}
