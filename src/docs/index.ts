// Main API
// Default renderers
// Re-export from subcommand-router for convenience
export { resolveLazyCommand } from "../executor/subcommand-router.js";
export {
  createCommandRenderer,
  defaultRenderers,
  renderArgumentsList,
  renderArgumentsListFromArray,
  renderArgumentsTable,
  renderArgumentsTableFromArray,
  renderExamplesDefault,
  renderGlobalOptionsLink,
  renderGlobalOptionsTableFromArray,
  renderOptionsList,
  renderOptionsListFromArray,
  renderOptionsTable,
  renderOptionsTableFromArray,
  renderRootHeader,
  renderSubcommandsTable,
  renderSubcommandsTableFromArray,
  renderUsage,
} from "./default-renderers.js";
export type { CreateCommandRendererOptions } from "./default-renderers.js";
// Comparator utilities
export { compareWithExisting, formatDiff, writeFile } from "./doc-comparator.js";
export type { DeleteFileFs } from "./doc-comparator.js";
// Document generator utilities
export { buildCommandInfo, collectAllCommands } from "./doc-generator.js";
export type { BuildCommandInfoOptions, CollectAllCommandsOptions } from "./doc-generator.js";
// Example executor
export { executeExamples } from "./example-executor.js";
export { assertDocMatch, generateDoc, initDocFile } from "./golden-test.js";
// Args table renderer
export { renderArgsTable } from "./render-args.js";
export type { ArgsShape, ArgsTableOptions } from "./render-args.js";
// Command index renderer
export { renderCommandIndex } from "./render-index.js";
export type { CommandCategory, CommandIndexOptions } from "./render-index.js";
export {
  commandEndMarker,
  commandStartMarker,
  COMMAND_MARKER_PREFIX,
  UPDATE_GOLDEN_ENV,
} from "./types.js";
// Types
export type {
  ArgumentsRenderContext,
  ArgumentsRenderFunction,
  CommandInfo,
  DefaultRendererOptions,
  ExampleCommandConfig,
  ExampleConfig,
  ExampleExecutionResult,
  ExamplesRenderContext,
  ExamplesRenderFunction,
  ExamplesRenderOptions,
  FileConfig,
  FileMapping,
  FormatterFunction,
  GenerateDocConfig,
  GenerateDocResult,
  GlobalOptionsRenderContext,
  GlobalOptionsRenderFunction,
  OptionsRenderContext,
  OptionsRenderFunction,
  PathConfig,
  RenderContentOptions,
  RenderFunction,
  RootCommandInfo,
  RootHeaderRenderContext,
  RootHeaderRenderFunction,
  SectionRenderFunction,
  SimpleRenderContext,
  SimpleRenderFunction,
  SubCommandInfo,
  SubcommandsRenderContext,
  SubcommandsRenderFunction,
  SubcommandsRenderOptions,
} from "./types.js";
