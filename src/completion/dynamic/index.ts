/**
 * Dynamic completion module
 *
 * Provides runtime completion through the __complete command pattern,
 * similar to Cobra (Go) and Click (Python).
 */

// Candidate generation
export {
  CompletionDirective,
  generateCandidates,
  type CandidateResult,
  type CompletionCandidate,
} from "./candidate-generator.js";
// Complete command
export { createDynamicCompleteCommand, hasCompleteCommand } from "./complete-command.js";
// Context parsing
export {
  parseCompletionContext,
  type CompletionContext,
  type CompletionType,
} from "./context-parser.js";
// Shell-specific formatting
export { formatForShell, type ShellFormatOptions } from "./shell-formatter.js";
