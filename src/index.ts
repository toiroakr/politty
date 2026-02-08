/**
 * politty - A lightweight CLI framework with zod v4 registry integration
 *
 * @packageDocumentation
 */

// Core exports
export { arg, type ArgMeta } from "./core/arg-registry.js";
export { createDefineCommand, defineCommand } from "./core/command.js";
export { runCommand, runMain } from "./core/runner.js";
export {
  extractFields,
  getUnknownKeysMode,
  toKebabCase,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "./core/schema-extractor.js";
// Utility exports
export {
  generateHelp,
  type BuiltinOptionDescriptions,
  type CommandContext,
  type HelpOptions,
} from "./output/help-generator.js";
export { isColorEnabled, logger, setColorEnabled, styles, symbols } from "./output/logger.js";
export { renderInline, renderMarkdown } from "./output/markdown-renderer.js";
// Parser exports
export { parseArgv, type ParsedArgv, type ParserOptions } from "./parser/argv-parser.js";
// Type exports
export type {
  AnyCommand,
  ArgsSchema,
  CleanupContext,
  // Log types
  CollectedLogs,
  // Command types
  Command,
  CommandBase,
  // Example types
  Example,
  // Global args (for declaration merging)
  GlobalArgs,
  LogEntry,
  // Logger type
  Logger,
  LogLevel,
  LogStream,
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
  // Subcommand types
  SubCommandsRecord,
  SubCommandValue,
} from "./types.js";
// Command definition validation
export {
  DuplicateAliasError,
  DuplicateFieldError,
  formatCommandValidationErrors,
  PositionalConfigError,
  ReservedAliasError,
  validateCommand,
  validateDuplicateAliases,
  validateDuplicateFields,
  validatePositionalConfig,
  validateReservedAliases,
  type CommandValidationError,
  type CommandValidationResult,
} from "./validator/command-validator.js";
export { formatValidationErrors } from "./validator/zod-validator.js";
// Validation types
export type { ValidationError, ValidationResult } from "./validator/zod-validator.js";
