/**
 * Types for shell completion generation
 */

import type { AnyCommand } from "../types.js";

/**
 * Supported shell types for completion
 */
export type ShellType = "bash" | "zsh" | "fish";

/**
 * Options for completion generation
 */
export interface CompletionOptions {
  /** The shell type to generate completion for */
  shell: ShellType;
  /** The command name as it will be invoked */
  programName: string;
  /** Include subcommand completions (default: true) */
  includeSubcommands?: boolean;
  /** Include description in completions where supported (default: true) */
  includeDescriptions?: boolean;
}

/**
 * Information about a completable option
 */
export interface CompletableOption {
  /** Long option name (e.g., "verbose") */
  name: string;
  /** CLI name (kebab-case, e.g., "dry-run") */
  cliName: string;
  /** Short alias (e.g., "v") */
  alias?: string | undefined;
  /** Description for completion */
  description?: string | undefined;
  /** Whether this option takes a value */
  takesValue: boolean;
  /** Type of value expected */
  valueType: "string" | "number" | "boolean" | "array" | "unknown";
  /** Whether the option is required */
  required: boolean;
}

/**
 * Information about a subcommand for completion
 */
export interface CompletableSubcommand {
  /** Subcommand name */
  name: string;
  /** Subcommand description */
  description?: string | undefined;
  /** Nested subcommands */
  subcommands: CompletableSubcommand[];
  /** Options for this subcommand */
  options: CompletableOption[];
}

/**
 * Extracted completion data from a command
 */
export interface CompletionData {
  /** The root command */
  command: CompletableSubcommand;
  /** Program name */
  programName: string;
  /** Global options (available to all subcommands) */
  globalOptions: CompletableOption[];
}

/**
 * Result of completion generation
 */
export interface CompletionResult {
  /** The generated completion script */
  script: string;
  /** The shell type this script is for */
  shell: ShellType;
  /** Instructions for installing the completion */
  installInstructions: string;
}

/**
 * Generator function type for shell completions
 */
export type CompletionGenerator = (
  command: AnyCommand,
  options: CompletionOptions,
) => CompletionResult;
