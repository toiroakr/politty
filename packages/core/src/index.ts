/**
 * @politty/core - validator-agnostic core of the politty CLI framework
 *
 * Parsing, help, completion, docs, skill, and prompt layers that work off
 * neutral field metadata. Schema-library integration is provided by an
 * adapter package (`@politty/zod`, ...), which registers its adapter and
 * re-exports this API — users never import this package directly.
 *
 * @packageDocumentation
 */

// Core exports
// Completion exports
export type { InferSchemaOutput, SchemaLike } from "./adapter/standard-schema.js";
export { runPolittyCli } from "./cli-main.js";
export {
  createCompileCacheShimGenerator,
  type GenerateCompileCacheShimOptions,
  type GenerateCompileCacheShimResult,
} from "./compile-cache-shim.js";
export {
  generateBundledCompletionWorker,
  generateCompletion,
  withCompletionCommand,
  type CompletionOptions,
  type CompletionResult,
  type GenerateBundledCompletionWorkerOptions,
  type GenerateBundledCompletionWorkerResult,
  type WithCompletionOptions,
} from "./completion/index.js";
export {
  arg,
  type ArgFn,
  type ArgMeta,
  type CompletionMeta,
  type CompletionType,
  type CustomCompletion,
  type EffectContext,
  type PromptMeta,
  type PromptType,
  type ValidateArgMeta,
} from "./core/arg-registry.js";
export { createDualCaseProxy } from "./core/case-proxy.js";
export type { CamelCase, KebabCase, WithCaseVariants } from "./core/case-types.js";
export {
  createDefineCommand,
  defineCommand,
  type BoundDefineCommandFn,
  type CreateDefineCommandFn,
  type DefineCommandFn,
  type MergedArgs,
} from "./core/command.js";
export type {
  CompletionDirectiveMask,
  DynamicCompletionCandidate,
  DynamicCompletionContext,
  DynamicCompletionResolver,
  DynamicCompletionResult,
} from "./core/dynamic-completion-types.js";
export type {
  ExpandCandidate,
  ExpandCompletion,
  ResolvedExpandCandidate,
} from "./core/expand-completion-types.js";
export { runCommand, runMain } from "./core/runner.js";
export {
  extractFields,
  getUnknownKeysMode,
  toCamelCase,
  toKebabCase,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "./core/schema-extractor.js";
export { isLazyCommand, lazy, type LazyCommand } from "./lazy.js";
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
  ArgSource,
  ArgsSchema,
  CleanupContext,
  // Log types
  CollectedLogs,
  // Command types
  Command,
  CommandBase,
  // Example types
  Example,
  // Global args
  GlobalArgs,
  // Global lifecycle context types
  GlobalCleanupContext,
  GlobalSetupContext,
  LogEntry,
  LogLevel,
  LogStream,
  // Logger type
  Logger,
  // Options and result types
  MainOptions,
  NonRunnableCommand,
  PromptResolver,
  RunCommandOptions,
  RunInvocation,
  RunResult,
  RunResultFailure,
  RunResultSuccess,
  RunnableCommand,
  // Context types
  SetupContext,
  SubCommandValue,
  // Subcommand types
  SubCommandsRecord,
  UnknownSubcommandHandler,
} from "./types.js";
// Command definition validation
export { formatValidationErrors } from "./validator/args-validator.js";
export {
  CaseVariantCollisionError,
  DuplicateAliasError,
  DuplicateFieldError,
  DuplicateNegationError,
  FieldTypeConflictError,
  PositionalConfigError,
  ReservedAliasError,
  ReservedFieldNameError,
  formatCommandValidationErrors,
  validateCaseVariantCollisions,
  validateCommand,
  validateCrossSchemaCollisions,
  validateDuplicateAliases,
  validateDuplicateFields,
  validateDuplicateNegations,
  validatePositionalConfig,
  validateReservedAliases,
  validateReservedFieldNames,
  type CommandValidationError,
  type CommandValidationResult,
} from "./validator/command-validator.js";
// Validation types
export type { ValidationError, ValidationResult } from "./validator/args-validator.js";
