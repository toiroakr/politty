/**
 * politty - A lightweight CLI framework with zod v4 registry integration
 *
 * @packageDocumentation
 */

// Core exports
export { arg, type ArgMeta } from "./core/arg-registry.js";
export { defineCommand } from "./core/command.js";
export { runCommand, runMain } from "./core/runner.js";
export {
  extractFields,
  PositionalConfigError,
  ReservedAliasError,
  validatePositionalConfig,
  validateReservedAliases,
  type ExtractedFields,
  type ResolvedFieldMeta,
} from "./core/schema-extractor.js";
// Utility exports
export {
  generateHelp,
  type BuiltinOptionDescriptions,
  type CommandContext,
  type HelpOptions,
} from "./output/help-generator.js";
export { isColorEnabled, logger, setColorEnabled, styles, symbols } from "./output/logger.js";
// Type exports
export type {
  AnyCommand,
  ArgsSchema,
  CleanupContext,
  // Command types
  Command,
  CommandBase,
  CommandConfig,
  // Options and result types
  MainOptions,
  NonRunnableCommand,
  RunCommandOptions,
  RunnableCommand,
  RunResult,
  RunResultFailure,
  RunResultSuccess,
  // Context types
  SetupContext,
} from "./types.js";
export { formatValidationErrors } from "./validator/zod-validator.js";
// Validation types
export type { ValidationError, ValidationResult } from "./validator/zod-validator.js";
