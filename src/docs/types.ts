import type { ExtractedFields, ResolvedFieldMeta } from "../core/schema-extractor.js";
import type { AnyCommand } from "../types.js";

/**
 * Command information for rendering
 */
export interface CommandInfo {
  /** Command name */
  name: string;
  /** Command description */
  description?: string | undefined;
  /** Full command path (e.g., "my-cli config get") */
  fullCommandPath: string;
  /** Command path relative to root (e.g., "" for root, "config" for subcommand) */
  commandPath: string;
  /** Positional arguments */
  positionalArgs: ResolvedFieldMeta[];
  /** Options (non-positional arguments) */
  options: ResolvedFieldMeta[];
  /** Subcommand information */
  subCommands: SubCommandInfo[];
  /** Extracted field information from schema */
  extracted: ExtractedFields | null;
  /** Original command object */
  command: AnyCommand;
  /** Additional notes */
  notes?: string | undefined;
  /** File path where this command is rendered (for cross-file links) */
  filePath?: string | undefined;
  /** Map of command path to file path (for cross-file links) */
  fileMap?: Record<string, string> | undefined;
}

/**
 * Subcommand information
 */
export interface SubCommandInfo {
  /** Subcommand name */
  name: string;
  /** Subcommand description */
  description?: string | undefined;
  /** Full command path */
  fullPath: string[];
}

/**
 * Render function type for custom markdown generation
 */
export type RenderFunction = (info: CommandInfo) => string;

/**
 * Section render function type (legacy)
 * @param defaultContent - The default rendered content for this section
 * @param info - Command information
 * @returns The final content to render (return empty string to hide section)
 * @deprecated Use context-based render functions instead
 */
export type SectionRenderFunction = (defaultContent: string, info: CommandInfo) => string;

/**
 * Render options for options/arguments
 */
export interface RenderContentOptions {
  /** Style for rendering */
  style?: "table" | "list";
  /** Include heading (default: true) */
  withHeading?: boolean;
}

/**
 * Options render context
 */
export interface OptionsRenderContext {
  /** Options to render */
  options: ResolvedFieldMeta[];
  /** Render function that accepts options and optional rendering options */
  render: (options: ResolvedFieldMeta[], opts?: RenderContentOptions) => string;
  /** Heading prefix (e.g., "###") */
  heading: string;
  /** Command information */
  info: CommandInfo;
}
export type OptionsRenderFunction = (context: OptionsRenderContext) => string;

/**
 * Arguments render context
 */
export interface ArgumentsRenderContext {
  /** Arguments to render */
  args: ResolvedFieldMeta[];
  /** Render function that accepts arguments and optional rendering options */
  render: (args: ResolvedFieldMeta[], opts?: RenderContentOptions) => string;
  /** Heading prefix (e.g., "###") */
  heading: string;
  /** Command information */
  info: CommandInfo;
}
export type ArgumentsRenderFunction = (context: ArgumentsRenderContext) => string;

/**
 * Subcommands render options
 */
export interface SubcommandsRenderOptions {
  /** Generate anchor links */
  generateAnchors?: boolean;
  /** Include heading (default: true) */
  withHeading?: boolean;
}

/**
 * Subcommands render context
 */
export interface SubcommandsRenderContext {
  /** Subcommands to render */
  subcommands: SubCommandInfo[];
  /** Render function that accepts subcommands and optional rendering options */
  render: (subcommands: SubCommandInfo[], opts?: SubcommandsRenderOptions) => string;
  /** Heading prefix (e.g., "###") */
  heading: string;
  /** Command information */
  info: CommandInfo;
}
export type SubcommandsRenderFunction = (context: SubcommandsRenderContext) => string;

/**
 * Simple section render context (for description, usage, notes, footer)
 */
export interface SimpleRenderContext {
  /** Default content */
  content: string;
  /** Heading prefix (e.g., "###") */
  heading: string;
  /** Command information */
  info: CommandInfo;
}
export type SimpleRenderFunction = (context: SimpleRenderContext) => string;

/**
 * Default renderer customization options
 */
export interface DefaultRendererOptions {
  /** Heading level (default: 1) */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Option display style */
  optionStyle?: "table" | "list";
  /** Generate anchor links to subcommands */
  generateAnchors?: boolean;
  /** Include subcommand details */
  includeSubcommandDetails?: boolean;
  /** Custom renderer for description section */
  renderDescription?: SimpleRenderFunction;
  /** Custom renderer for usage section */
  renderUsage?: SimpleRenderFunction;
  /** Custom renderer for arguments section */
  renderArguments?: ArgumentsRenderFunction;
  /** Custom renderer for options section */
  renderOptions?: OptionsRenderFunction;
  /** Custom renderer for subcommands section */
  renderSubcommands?: SubcommandsRenderFunction;
  /** Custom renderer for notes section */
  renderNotes?: SimpleRenderFunction;
  /** Custom renderer for footer (default content is empty) */
  renderFooter?: SimpleRenderFunction;
}

/**
 * Per-file configuration with custom renderer
 */
export interface FileConfig {
  /** Command paths to include in this file (e.g., ["", "user", "config get"]) */
  commands: string[];
  /** Custom renderer for this file (optional) */
  render?: RenderFunction;
  /** File title (prepended to the file content) */
  title?: string;
  /** File description (added after title) */
  description?: string;
}

/**
 * File mapping configuration
 * Key: output file path (e.g., "docs/cli.md")
 * Value: command paths array or FileConfig object
 *
 * @example
 * // Simple: single file with multiple commands
 * { "docs/cli.md": ["", "user", "config"] }
 *
 * // With custom renderer
 * { "docs/cli.md": { commands: [""], render: customRenderer } }
 */
export type FileMapping = Record<string, string[] | FileConfig>;

/**
 * generateDoc configuration
 */
export interface GenerateDocConfig {
  /** Command to generate documentation for */
  command: AnyCommand;
  /** File output configuration (command path -> file mapping) */
  files: FileMapping;
  /** Command paths to ignore (including their subcommands) */
  ignores?: string[];
  /** Default renderer options (used when render is not specified per file) */
  format?: DefaultRendererOptions;
}

/**
 * generateDoc result
 */
export interface GenerateDocResult {
  /** Whether all files matched or were updated successfully */
  success: boolean;
  /** File processing results */
  files: Array<{
    /** File path */
    path: string;
    /** Status of this file */
    status: "match" | "created" | "updated" | "diff";
    /** Diff content (only when status is "diff") */
    diff?: string | undefined;
  }>;
  /** Error message (when success is false) */
  error?: string | undefined;
}

/**
 * Environment variable name for update mode
 */
export const UPDATE_GOLDEN_ENV = "POLITTY_DOCS_UPDATE";
