// Main API
// Default renderers
export {
    createCommandRenderer,
    defaultRenderers,
    renderArgumentsList,
    renderArgumentsListFromArray,
    renderArgumentsTable,
    renderArgumentsTableFromArray,
    renderOptionsList,
    renderOptionsListFromArray,
    renderOptionsTable,
    renderOptionsTableFromArray,
    renderSubcommandsTable,
    renderSubcommandsTableFromArray,
    renderUsage
} from "./default-renderers.js";
// Comparator utilities
export { compareWithExisting, formatDiff, writeFile } from "./doc-comparator.js";
// Document generator utilities
export { buildCommandInfo, collectAllCommands, resolveSubcommand } from "./doc-generator.js";
export { assertDocMatch } from "./golden-test.js";
export { UPDATE_GOLDEN_ENV } from "./types.js";
// Types
export type {
    ArgumentsRenderContext,
    ArgumentsRenderFunction,
    CommandInfo,
    DefaultRendererOptions,
    FileConfig,
    FileMapping,
    GenerateDocConfig,
    GenerateDocResult,
    OptionsRenderContext,
    OptionsRenderFunction,
    RenderContentOptions,
    RenderFunction,
    SectionRenderFunction,
    SimpleRenderContext,
    SimpleRenderFunction,
    SubCommandInfo,
    SubcommandsRenderContext,
    SubcommandsRenderFunction,
    SubcommandsRenderOptions
} from "./types.js";
