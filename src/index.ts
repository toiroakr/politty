/**
 * politty - A lightweight CLI framework with zod v4 registry integration
 *
 * @packageDocumentation
 */

// Core exports
export { defineCommand } from "./core/command.js";
export { runMain } from "./core/runner.js";
export { arg, type ArgMeta } from "./core/arg-registry.js";

// Utility exports
export {
  generateHelp,
  type HelpOptions,
  type BuiltinOptionDescriptions,
  type CommandContext,
} from "./output/help-generator.js";
export { logger, styles, symbols, setColorEnabled, isColorEnabled } from "./output/logger.js";
export {
  extractFields,
  validatePositionalConfig,
  validateReservedAliases,
  PositionalConfigError,
  ReservedAliasError,
  type ExtractedFields,
  type ResolvedFieldMeta,
} from "./core/schema-extractor.js";

// Type exports
export type {
  // Command types
  Command,
  CommandBase,
  RunnableCommand,
  NonRunnableCommand,
  AnyCommand,
  CommandConfig,
  ArgsSchema,
  // Context types
  SetupContext,
  CleanupContext,
  // Options and result types
  MainOptions,
  RunResult,
} from "./types.js";

// Validation types
export type { ValidationError, ValidationResult } from "./validator/zod-validator.js";
export { formatValidationErrors } from "./validator/zod-validator.js";
