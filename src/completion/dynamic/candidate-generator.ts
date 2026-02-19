/**
 * Generate completion candidates based on context
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
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

function listFilteredFiles(currentWord: string, extensions: string[]): CompletionCandidate[] {
  const normalizedExts = new Set(
    extensions.map((ext) => ext.trim().replace(/^\./, "")).filter((ext) => ext.length > 0),
  );

  if (normalizedExts.size === 0) {
    return [];
  }

  let dir = ".";
  if (currentWord.includes("/")) {
    dir = dirname(currentWord) || ".";
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const candidates: CompletionCandidate[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const path = dir === "." ? `${entry.name}/` : `${join(dir, entry.name)}/`;
        candidates.push({ value: path, type: "directory" });
      } else {
        const dotIndex = entry.name.lastIndexOf(".");
        const ext = dotIndex >= 0 ? entry.name.slice(dotIndex + 1) : "";
        if (normalizedExts.has(ext)) {
          const path = dir === "." ? entry.name : join(dir, entry.name);
          candidates.push({ value: path, type: "file" });
        }
      }
    }

    return candidates;
  } catch {
    return [];
  }
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
  let directive = CompletionDirective.FilterPrefix;

  if (!context.targetOption) {
    return { candidates, directive };
  }

  const vc = context.targetOption.valueCompletion;
  if (!vc) {
    // No specific completion, return empty
    return { candidates, directive };
  }

  switch (vc.type) {
    case "choices":
      if (vc.choices) {
        for (const choice of vc.choices) {
          candidates.push({
            value: choice,
            type: "value",
          });
        }
      }
      break;

    case "file":
      if (vc.extensions && vc.extensions.length > 0) {
        candidates.push(...listFilteredFiles(context.currentWord, vc.extensions));
      } else {
        directive |= CompletionDirective.FileCompletion;
      }
      break;

    case "directory":
      directive |= CompletionDirective.DirectoryCompletion;
      break;

    case "command":
      // Shell command completion - the shell script will execute the command
      // We return empty candidates and let the shell handle it
      if (vc.shellCommand) {
        // Return the shell command as a special candidate
        candidates.push({
          value: `__command:${vc.shellCommand}`,
          type: "value",
        });
      }
      break;

    case "none":
      // No completion
      directive |= CompletionDirective.NoFileCompletion;
      break;
  }

  return { candidates, directive };
}

/**
 * Generate positional argument candidates
 */
function generatePositionalCandidates(context: CompletionContext): CandidateResult {
  const candidates: CompletionCandidate[] = [];
  let directive = CompletionDirective.FilterPrefix;

  // Get the positional at current index
  const positionalIndex = context.positionalIndex ?? 0;
  const positional = context.positionals[positionalIndex];

  if (!positional) {
    // No more positionals expected, maybe return subcommands?
    return { candidates, directive };
  }

  const vc = positional.valueCompletion;
  if (!vc) {
    // No specific completion
    return { candidates, directive };
  }

  switch (vc.type) {
    case "choices":
      if (vc.choices) {
        for (const choice of vc.choices) {
          candidates.push({
            value: choice,
            description: positional.description,
            type: "value",
          });
        }
      }
      break;

    case "file":
      if (vc.extensions && vc.extensions.length > 0) {
        candidates.push(...listFilteredFiles(context.currentWord, vc.extensions));
      } else {
        directive |= CompletionDirective.FileCompletion;
      }
      break;

    case "directory":
      directive |= CompletionDirective.DirectoryCompletion;
      break;

    case "command":
      if (vc.shellCommand) {
        candidates.push({
          value: `__command:${vc.shellCommand}`,
          type: "value",
        });
      }
      break;

    case "none":
      directive |= CompletionDirective.NoFileCompletion;
      break;
  }

  return { candidates, directive };
}

/**
 * Format candidates as shell completion output
 *
 * Format: value\tdescription (tab-separated)
 * Last line: :directive_code
 */
export function formatOutput(result: CandidateResult): string {
  const lines: string[] = [];

  for (const candidate of result.candidates) {
    if (candidate.description) {
      lines.push(`${candidate.value}\t${candidate.description}`);
    } else {
      lines.push(candidate.value);
    }
  }

  // Add directive as last line
  lines.push(`:${result.directive}`);

  return lines.join("\n");
}
