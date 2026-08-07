/**
 * Shell-specific output formatter for completion candidates
 *
 * Formats completion candidates into shell-native output so that
 * shell scripts can consume them with minimal parsing logic.
 */

import type { ShellType } from "../types.js";
import { CompletionDirective, type CandidateResult } from "./candidate-generator.js";

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
 * Append extension metadata and directive to output lines
 */
function appendMetadata(lines: string[], result: CandidateResult): void {
  // The directive sentinel is always the final line. Fold the file
  // `@ext:`/`@matcher:` metadata onto it (tab-separated) instead of emitting
  // standalone lines, so candidate lines stay unambiguous: a dynamic resolver
  // may legitimately return a value starting with `@ext:`/`@matcher:`, and the
  // dispatcher must not mistake such a candidate for metadata. Static consumers
  // never receive ext/matcher (file fields bake their own completion), so their
  // plain `:<directive>` line is unchanged.
  let directiveLine = `:${result.directive}`;
  if (result.fileExtensions && result.fileExtensions.length > 0) {
    directiveLine += `\t@ext:${result.fileExtensions.join(",")}`;
  }
  if (result.fileMatchers && result.fileMatchers.length > 0) {
    directiveLine += `\t@matcher:${result.fileMatchers.join(",")}`;
  }
  lines.push(directiveLine);
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
  const filtered =
    (result.directive & CompletionDirective.FilterPrefix) !== 0 && options.currentWord
      ? result.candidates.filter((c) => c.value.startsWith(options.currentWord))
      : result.candidates;

  const lines: string[] = filtered.map((c) =>
    options.inlinePrefix ? `${options.inlinePrefix}${c.value}` : c.value,
  );

  appendMetadata(lines, result);
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

  appendMetadata(lines, result);
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

  appendMetadata(lines, result);
  return lines.join("\n");
}
