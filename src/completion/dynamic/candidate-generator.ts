/**
 * Generate completion candidates based on context
 */

import { execSync } from "node:child_process";
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
  /** File extensions for shell-native filtering (e.g., ["json", "yaml"]) */
  fileExtensions?: string[] | undefined;
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
 * Result of resolving value candidates
 */
interface ValueResolutionResult {
  directive: number;
  fileExtensions?: string[] | undefined;
}

/**
 * Resolve value completion, executing shell commands and file lookups in JS
 */
function resolveValueCandidates(
  vc: { type: string; choices?: string[]; shellCommand?: string; extensions?: string[] },
  candidates: CompletionCandidate[],
  _currentWord: string,
  description?: string,
): ValueResolutionResult {
  let directive = CompletionDirective.FilterPrefix;
  let fileExtensions: string[] | undefined;

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
        // Delegate to shell with extension filter metadata
        fileExtensions = Array.from(
          new Set(
            vc.extensions
              .map((ext) => ext.trim().replace(/^\./, ""))
              .filter((ext) => ext.length > 0),
          ),
        );
        if (fileExtensions.length === 0) {
          // All extensions were invalid → treat as unfiltered file completion
          fileExtensions = undefined;
          directive |= CompletionDirective.FileCompletion;
        }
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

  return { directive, fileExtensions };
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

  const { directive, fileExtensions } = resolveValueCandidates(vc, candidates, context.currentWord);
  return { candidates, directive, fileExtensions };
}

/**
 * Generate positional argument candidates
 */
function generatePositionalCandidates(context: CompletionContext): CandidateResult {
  const candidates: CompletionCandidate[] = [];

  // Get the positional at current index, clamping to last (variadic) positional
  const positionalIndex = context.positionalIndex ?? 0;
  const positional =
    context.positionals[positionalIndex] ??
    (context.positionals.at(-1)?.variadic ? context.positionals.at(-1) : undefined);

  if (!positional) {
    return { candidates, directive: CompletionDirective.FilterPrefix };
  }

  const vc = positional.valueCompletion;
  if (!vc) {
    return { candidates, directive: CompletionDirective.FilterPrefix };
  }

  const { directive, fileExtensions } = resolveValueCandidates(
    vc,
    candidates,
    context.currentWord,
    positional.description,
  );
  return { candidates, directive, fileExtensions };
}
