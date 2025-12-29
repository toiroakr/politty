// Main API
// Default renderers
export {
    createCommandRenderer,
    defaultRenderers,
    renderArgumentsList,
    renderArgumentsTable,
    renderOptionsList,
    renderOptionsTable,
    renderSubcommandsTable,
    renderUsage
} from "./default-renderers.js";
// Comparator utilities
export { compareWithExisting, formatDiff, writeFile } from "./doc-comparator.js";
// Document generator utilities
export { buildCommandInfo, collectAllCommands, resolveSubcommand } from "./doc-generator.js";
export { assertDocMatch, generateDoc } from "./golden-test.js";
export { UPDATE_GOLDEN_ENV } from "./types.js";
// Types
export type {
    CommandInfo,
    DefaultRendererOptions,
    FileConfig,
    FileMapping,
    GenerateDocConfig,
    GenerateDocResult,
    RenderFunction,
    SectionRenderFunction,
    SubCommandInfo
} from "./types.js";





