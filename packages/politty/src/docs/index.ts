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
  SECTION_MARKER_PREFIX,
  UPDATE_GOLDEN_ENV,
  commandEndMarker,
  commandStartMarker,
} from "./types.js";
// `md` tag composers
export { createCommandMd, createLayoutMd, formatTemplate } from "./md-tag.js";
export type {
  CommandMd,
  CommandMdOptions,
  LayoutMd,
  LayoutMdInputs,
  MdTagFn,
  SectionContent,
  SectionEdit,
  SectionName,
  SectionsSpec,
} from "./md-tag.js";
// Types
export type {
  CommandIndexOptions,
  CommandInfo,
  CommandMap,
  CommandOverride,
  DefaultRendererOptions,
  ExampleCommandConfig,
  ExampleConfig,
  ExampleExecutionResult,
  ExamplesRenderOptions,
  FileConfig,
  FileMapping,
  FormatterFunction,
  GenerateDocConfig,
  GenerateDocResult,
  HeadingLevel,
  PathConfig,
  RenderFunction,
  RootDocConfig,
  SubCommandInfo,
} from "./types.js";
