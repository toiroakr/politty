/**
 * Dynamic completion module
 *
 * Provides runtime completion through the __complete command pattern,
 * similar to Cobra (Go) and Click (Python).
 */

// Context parsing
// Candidate generation
export {
  CompletionDirective,
  formatOutput,
  generateCandidates,
  type CandidateResult,
  type CompletionCandidate,
} from "./candidate-generator.js";
// Complete command
export { createDynamicCompleteCommand, hasCompleteCommand } from "./complete-command.js";
export {
  parseCompletionContext,
  type CompletionContext,
  type CompletionType,
} from "./context-parser.js";
