import { styles, symbols } from "../output/logger.js";
import type { ValidationError } from "./zod-validator.js";

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // substitution
          matrix[i]![j - 1]! + 1, // insertion
          matrix[i - 1]![j]! + 1, // deletion
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

/**
 * Find similar strings from a list
 */
function findSimilar(target: string, candidates: string[]): string[] {
  const threshold = Math.max(2, Math.floor(target.length / 2));

  return candidates
    .map((candidate) => ({
      candidate,
      distance: levenshteinDistance(target.toLowerCase(), candidate.toLowerCase()),
    }))
    .filter(({ distance }) => distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
    .map(({ candidate }) => candidate)
    .slice(0, 3);
}

/**
 * Format validation errors into a human-readable message
 *
 * @param errors - Array of validation errors
 * @returns Formatted error message
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) {
    return "";
  }

  const lines: string[] = [styles.error("Validation errors:")];

  for (const error of errors) {
    const path = error.path.join(".");
    lines.push(`  ${symbols.bullet} ${styles.bold(path)}: ${error.message}`);
  }

  return lines.join("\n");
}

/**
 * Format unknown flag error with suggestions
 *
 * @param flag - The unknown flag (e.g., "--verbos")
 * @param knownFlags - List of known flag names
 * @returns Formatted error message with suggestions
 */
export function formatUnknownFlag(flag: string, knownFlags: string[]): string {
  const flagName = flag.replace(/^-{1,2}/, "");
  const similar = findSimilar(flagName, knownFlags);

  let message = `${styles.error("Unknown option:")} ${styles.bold(flag)}`;

  if (similar.length > 0) {
    message += `\n\n${styles.info("Did you mean?")}`;
    for (const suggestion of similar) {
      message += `\n  ${symbols.arrow} ${styles.option(`--${suggestion}`)}`;
    }
  }

  return message;
}

/**
 * Format unknown flag warning with suggestions (for strip mode)
 *
 * @param flag - The unknown flag (e.g., "--verbos")
 * @param knownFlags - List of known flag names
 * @returns Formatted warning message with suggestions
 */
export function formatUnknownFlagWarning(flag: string, knownFlags: string[]): string {
  const flagName = flag.replace(/^-{1,2}/, "");
  const similar = findSimilar(flagName, knownFlags);

  let message = `${styles.warning("Warning: Unknown option:")} ${styles.bold(flag)}`;

  if (similar.length > 0) {
    message += `\n\n${styles.info("Did you mean?")}`;
    for (const suggestion of similar) {
      message += `\n  ${symbols.arrow} ${styles.option(`--${suggestion}`)}`;
    }
  }

  return message;
}

/**
 * Format runtime error
 *
 * @param error - The error that occurred
 * @param debug - Whether to include stack trace
 * @returns Formatted error message
 */
export function formatRuntimeError(error: Error, debug: boolean): string {
  if (debug && error.stack) {
    return `${styles.error("Error:")} ${error.message}\n\n${styles.dim(error.stack)}`;
  }

  return `${styles.error("Error:")} ${error.message}`;
}

/**
 * Format unknown subcommand error with suggestions
 *
 * @param subcommand - The unknown subcommand name
 * @param knownSubcommands - List of known subcommand names
 * @returns Formatted error message with suggestions
 */
export function formatUnknownSubcommand(subcommand: string, knownSubcommands: string[]): string {
  const similar = findSimilar(subcommand, knownSubcommands);

  let message = `${styles.error("Unknown command:")} ${styles.bold(subcommand)}`;

  if (similar.length > 0) {
    message += `\n\n${styles.info("Did you mean?")}`;
    for (const suggestion of similar) {
      message += `\n  ${symbols.arrow} ${styles.command(suggestion)}`;
    }
  }

  return message;
}
