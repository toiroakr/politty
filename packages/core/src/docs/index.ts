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
  renderOptionsList,
  renderOptionsListFromArray,
  renderOptionsTable,
  renderOptionsTableFromArray,
  renderSubcommandsTable,
  renderSubcommandsTableFromArray,
  renderUsage,
} from "./default-renderers.js";
// Comparator utilities
export { compareWithExisting, formatDiff, writeFile } from "./doc-comparator.js";
export type { DeleteFileFs } from "./doc-comparator.js";
// Document generator utilities
export { buildCommandInfo, collectAllCommands } from "./doc-generator.js";
// Example executor
export { executeExamples } from "./example-executor.js";
export { assertDocMatch, generateDoc, initDocFile } from "./golden-test.js";
// Args table renderer
export { renderArgsTable } from "./render-args.js";
export type { ArgsShape, ArgsTableOptions } from "./render-args.js";
// Command index renderer
export { renderCommandIndex } from "./render-index.js";
export type { CommandCategory } from "./render-index.js";
export {
  DOCTOR_ENV,
  GLOBAL_OPTIONS_MARKER_PREFIX,
  INDEX_MARKER_PREFIX,
  ROOT_FOOTER_MARKER_PREFIX,
  ROOT_HEADER_MARKER_PREFIX,
  SECTION_MARKER_PREFIX,
  SECTION_TYPES,
  UPDATE_GOLDEN_ENV,
  globalOptionsEndMarker,
  globalOptionsStartMarker,
  indexEndMarker,
  indexStartMarker,
  rootFooterEndMarker,
  rootFooterStartMarker,
  rootHeaderEndMarker,
  rootHeaderStartMarker,
  sectionEndMarker,
  sectionStartMarker,
} from "./types.js";
// Types
export type {
  ArgumentsRenderContext,
  ArgumentsRenderFunction,
  CommandIndexOptions,
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
  HeadingLevel,
  OptionsRenderContext,
  OptionsRenderFunction,
  PathConfig,
  RenderContentOptions,
  RenderFunction,
  RootCommandInfo,
  RootDocConfig,
  SectionRenderFunction,
  SectionType,
  SimpleRenderContext,
  SimpleRenderFunction,
  SubCommandInfo,
  SubcommandsRenderContext,
  SubcommandsRenderFunction,
  SubcommandsRenderOptions,
} from "./types.js";
