/**
 * Shell-specific output formatter for completion candidates
 *
 * Formats completion candidates into shell-native output so that
 * shell scripts can consume them with minimal parsing logic.
 */

import type { ShellType } from "../types.js";
import {
  CompletionDirective,
  type CandidateResult,
  type CompletionCandidate,
} from "./candidate-generator.js";

/**
 * Options for shell-specific formatting
 */
export interface ShellFormatOptions {
  /** Target shell type */
  shell: ShellType;
  /** Current word being completed (used for prefix filtering) */
  currentWord: string;
  /** For bash: the prefix before '=' in --opt=value completions */
  inlinePrefix?: string | undefined;
}

/**
 * Format completion candidates for the specified shell
 *
 * @returns Shell-ready output string (lines separated by newline, last line is :directive)
 */
export function formatForShell(result: CandidateResult, options: ShellFormatOptions): string {
  switch (options.shell) {
    case "bash":
      return formatForBash(result, options);
    case "zsh":
      return formatForZsh(result, options);
    case "fish":
      return formatForFish(result, options);
  }
}

/**
 * Check if the FilterPrefix directive is set
 */
function shouldFilterPrefix(directive: number): boolean {
  return (directive & CompletionDirective.FilterPrefix) !== 0;
}

/**
 * Filter candidates by prefix
 */
function filterByPrefix(candidates: CompletionCandidate[], prefix: string): CompletionCandidate[] {
  if (!prefix) return candidates;
  return candidates.filter((c) => c.value.startsWith(prefix));
}

/**
 * Format for bash
 *
 * - Pre-filters candidates by currentWord prefix (replaces compgen -W)
 * - Handles --opt=value inline values by prepending prefix
 * - Outputs plain values only (no descriptions - bash COMPREPLY doesn't support them)
 * - Last line: :directive
 */
function formatForBash(result: CandidateResult, options: ShellFormatOptions): string {
  let { candidates } = result;

  if (shouldFilterPrefix(result.directive)) {
    candidates = filterByPrefix(candidates, options.currentWord);
  }

  const lines: string[] = candidates.map((c) => {
    if (options.inlinePrefix) {
      return `${options.inlinePrefix}${c.value}`;
    }
    return c.value;
  });

  lines.push(`:${result.directive}`);
  return lines.join("\n");
}

/**
 * Format for zsh
 *
 * - Outputs value:description pairs for _describe
 * - Colons in values/descriptions are escaped with backslash
 * - Last line: :directive
 */
function formatForZsh(result: CandidateResult, _options: ShellFormatOptions): string {
  const lines: string[] = result.candidates.map((c) => {
    const escapedValue = c.value.replace(/:/g, "\\:");
    if (c.description) {
      const escapedDesc = c.description.replace(/:/g, "\\:");
      return `${escapedValue}:${escapedDesc}`;
    }
    return escapedValue;
  });

  lines.push(`:${result.directive}`);
  return lines.join("\n");
}

/**
 * Format for fish
 *
 * - Outputs value\tdescription pairs
 * - Last line: :directive
 */
function formatForFish(result: CandidateResult, _options: ShellFormatOptions): string {
  const lines: string[] = result.candidates.map((c) => {
    if (c.description) {
      return `${c.value}\t${c.description}`;
    }
    return c.value;
  });

  lines.push(`:${result.directive}`);
  return lines.join("\n");
}
