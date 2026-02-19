/**
 * Generate completion candidates based on context
 */

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CompletionContext } from "./context-parser.js";

/**
 * Completion directive flags (bitwise)
 */
export const CompletionDirective = {
  /** Default completion behavior */
  Default: 0,
  /** Don't add space after completion */
  NoSpace: 1,
  /** Don't offer file completion (even if no other completions) */
  NoFileCompletion: 2,
  /** Filter completions using current word as prefix */
  FilterPrefix: 4,
  /** Keep the order of completions */
  KeepOrder: 8,
  /** Trigger file completion */
  FileCompletion: 16,
  /** Trigger directory completion */
  DirectoryCompletion: 32,
  /** Error occurred during completion */
  Error: 64,
} as const;

/**
 * A completion candidate
 */
export interface CompletionCandidate {
  /** The completion value */
  value: string;
  /** Optional description */
  description?: string | undefined;
  /** Type hint for display purposes */
  type?: "option" | "subcommand" | "value" | "file" | "directory";
}

/**
 * Result of candidate generation
 */
export interface CandidateResult {
  /** Completion candidates */
  candidates: CompletionCandidate[];
  /** Directive flags for shell behavior */
  directive: number;
}

/**
 * Generate completion candidates based on context
 */
export function generateCandidates(context: CompletionContext): CandidateResult {
  const candidates: CompletionCandidate[] = [];
  let directive = CompletionDirective.Default;

  switch (context.completionType) {
    case "subcommand":
      return generateSubcommandCandidates(context);

    case "option-name":
      return generateOptionNameCandidates(context);

    case "option-value":
      return generateOptionValueCandidates(context);

    case "positional":
      return generatePositionalCandidates(context);

    default:
      return { candidates, directive };
  }
}

/**
 * Execute a shell command and return results as candidates
 */
function executeShellCommand(command: string): CompletionCandidate[] {
  try {
    const output = execSync(command, { encoding: "utf-8", timeout: 5000 });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => ({ value: line, type: "value" as const }));
  } catch {
    return [];
  }
}

/**
 * List files matching extensions in the directory indicated by the current word prefix
 */
function resolveFileExtensions(extensions: string[], currentWord: string): CompletionCandidate[] {
  const normalized = Array.from(
    new Set(extensions.map((ext) => ext.trim().replace(/^\./, "")).filter((ext) => ext.length > 0)),
  );

  if (normalized.length === 0) {
    return [];
  }

  try {
    let dir: string;
    let prefix: string;

    if (currentWord.endsWith("/")) {
      // "configs/" → list contents of the directory
      dir = currentWord.slice(0, -1) || ".";
      prefix = "";
    } else if (currentWord && currentWord !== basename(currentWord)) {
      // "configs/p" → list contents matching prefix
      dir = dirname(currentWord);
      prefix = basename(currentWord);
    } else {
      // "" or "app" → list current directory
      dir = ".";
      prefix = currentWord;
    }

    const entries = readdirSync(dir, { withFileTypes: true });

    return entries
      .filter((entry) => {
        // Always include directories for navigation
        if (entry.isDirectory()) return entry.name.startsWith(prefix);
        // Filter files by extension and prefix
        if (!entry.name.startsWith(prefix)) return false;
        return normalized.some((ext) => entry.name.endsWith(`.${ext}`));
      })
      .map((entry) => {
        const value = dir === "." ? entry.name : join(dir, entry.name);
        return {
          value: entry.isDirectory() ? `${value}/` : value,
          type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Resolve value completion, executing shell commands and file lookups in JS
 */
function resolveValueCandidates(
  vc: { type: string; choices?: string[]; shellCommand?: string; extensions?: string[] },
  candidates: CompletionCandidate[],
  currentWord: string,
  description?: string,
): number {
  let directive = CompletionDirective.FilterPrefix;

  switch (vc.type) {
    case "choices":
      if (vc.choices) {
        for (const choice of vc.choices) {
          candidates.push({
            value: choice,
            description,
            type: "value",
          });
        }
      }
      break;

    case "file":
      if (vc.extensions && vc.extensions.length > 0) {
        // Extensions specified: resolve files in JS, directories via shell
        const fileCandidates = resolveFileExtensions(vc.extensions, currentWord);
        candidates.push(...fileCandidates.filter((c) => c.type !== "directory"));
        directive |= CompletionDirective.DirectoryCompletion;
      } else {
        // No extensions: let shell handle native file completion
        directive |= CompletionDirective.FileCompletion;
      }
      break;

    case "directory":
      directive |= CompletionDirective.DirectoryCompletion;
      break;

    case "command":
      // Execute shell command in JS and add results as candidates
      if (vc.shellCommand) {
        candidates.push(...executeShellCommand(vc.shellCommand));
      }
      break;

    case "none":
      directive |= CompletionDirective.NoFileCompletion;
      break;
  }

  return directive;
}

/**
 * Generate subcommand candidates
 */
function generateSubcommandCandidates(context: CompletionContext): CandidateResult {
  const candidates: CompletionCandidate[] = [];
  let directive = CompletionDirective.FilterPrefix;

  // Add subcommands
  for (const name of context.subcommands) {
    // Get description from the subcommand if possible
    let description: string | undefined;
    if (context.currentCommand.subCommands) {
      const sub = context.currentCommand.subCommands[name];
      if (sub && typeof sub !== "function") {
        description = sub.description;
      }
    }

    candidates.push({
      value: name,
      description,
      type: "subcommand",
    });
  }

  // Add options when no subcommands exist, or when typing an option prefix
  if (candidates.length === 0 || context.currentWord.startsWith("-")) {
    const optionResult = generateOptionNameCandidates(context);
    candidates.push(...optionResult.candidates);
  }

  return { candidates, directive };
}

/**
 * Generate option name candidates
 */
function generateOptionNameCandidates(context: CompletionContext): CandidateResult {
  const candidates: CompletionCandidate[] = [];
  const directive = CompletionDirective.FilterPrefix;

  // Filter out already used options
  const availableOptions = context.options.filter((opt) => {
    // Array options can be specified multiple times, so keep them available.
    if (opt.valueType === "array") {
      return true;
    }

    return !context.usedOptions.has(opt.cliName) && !context.usedOptions.has(opt.alias || "");
  });

  for (const opt of availableOptions) {
    candidates.push({
      value: `--${opt.cliName}`,
      description: opt.description,
      type: "option",
    });
  }

  // Add help option if not already used
  if (!context.usedOptions.has("help")) {
    candidates.push({
      value: "--help",
      description: "Show help information",
      type: "option",
    });
  }

  return { candidates, directive };
}

/**
 * Generate option value candidates
 */
function generateOptionValueCandidates(context: CompletionContext): CandidateResult {
  const candidates: CompletionCandidate[] = [];

  if (!context.targetOption) {
    return { candidates, directive: CompletionDirective.FilterPrefix };
  }

  const vc = context.targetOption.valueCompletion;
  if (!vc) {
    return { candidates, directive: CompletionDirective.FilterPrefix };
  }

  const directive = resolveValueCandidates(vc, candidates, context.currentWord);
  return { candidates, directive };
}

/**
 * Generate positional argument candidates
 */
function generatePositionalCandidates(context: CompletionContext): CandidateResult {
  const candidates: CompletionCandidate[] = [];

  // Get the positional at current index
  const positionalIndex = context.positionalIndex ?? 0;
  const positional = context.positionals[positionalIndex];

  if (!positional) {
    return { candidates, directive: CompletionDirective.FilterPrefix };
  }

  const vc = positional.valueCompletion;
  if (!vc) {
    return { candidates, directive: CompletionDirective.FilterPrefix };
  }

  const directive = resolveValueCandidates(
    vc,
    candidates,
    context.currentWord,
    positional.description,
  );
  return { candidates, directive };
}
