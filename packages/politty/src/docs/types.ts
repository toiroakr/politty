import type { ExtractedFields, ResolvedFieldMeta } from "../core/schema-extractor.js";
import type { AnyCommand, ArgsSchema, Example } from "../types.js";
import type { CommandMd, LayoutMd } from "./md-tag.js";
import type { ArgsShape, ArgsTableOptions } from "./render-args.js";

/** Heading level for markdown headings (1-6) */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Options for rendering command index
 */
export type CommandIndexOptions = {
  /** Base heading level (default: 3, which renders as ###) */
  headingLevel?: HeadingLevel;
  /** Only include leaf commands (commands without subcommands). Default: true */
  leafOnly?: boolean;
};

/**
 * Command information for rendering
 */
export interface CommandInfo {
  /** Command name */
  name: string;
  /** Command description */
  description?: string | undefined;
  /** Alternative names (aliases) for this command */
  aliases?: string[] | undefined;
  /** Full command path (e.g., "my-cli config get") */
  fullCommandPath: string;
  /** Command path relative to root (e.g., "" for root, "config" for subcommand) */
  commandPath: string;
  /** Command depth (1 for root commands, 2 for subcommands, etc.) */
  depth: number;
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
  /** Example definitions from command */
  examples?: Example[] | undefined;
  /** Example execution results (populated when examples are executed) */
  exampleResults?: ExampleExecutionResult[] | undefined;
  /** Path to root document file (for global options link generation) */
  rootDocPath?: string | undefined;
  /** Whether global options exist (for global options link generation) */
  hasGlobalOptions?: boolean;
}

/**
 * Subcommand information
 */
export interface SubCommandInfo {
  /** Subcommand name */
  name: string;
  /** Subcommand description */
  description?: string | undefined;
  /** Alternative names (aliases) for this subcommand */
  aliases?: string[] | undefined;
  /** Full command path */
  fullPath: string[];
}

/**
 * Example execution result
 */
export interface ExampleExecutionResult {
  /** Command arguments that were executed */
  cmd: string;
  /** Description of the example */
  desc: string;
  /** Expected output (if defined in example) */
  expectedOutput?: string | undefined;
  /** Captured stdout */
  stdout: string;
  /** Captured stderr */
  stderr: string;
  /** Whether execution was successful */
  success: boolean;
}

/**
 * Example execution config for a specific command path
 * If a command path is specified in ExampleConfig, its examples will be executed
 */
export interface ExampleCommandConfig {
  /** Mock setup before running examples */
  mock?: () => void | Promise<void>;
  /** Mock cleanup after running examples */
  cleanup?: () => void | Promise<void>;
}

/**
 * Example execution configuration
 * Key is command path (e.g., "", "config", "config get")
 * All specified command paths will have their examples executed
 *
 * @example
 * // With mock setup
 * { "": { mock: () => mockFs(), cleanup: () => restoreFs() } }
 *
 * // Without mock (just execute)
 * { "user": true }
 */
export type ExampleConfig = Record<string, ExampleCommandConfig | true>;

/**
 * Render function type for custom markdown generation
 */
export type RenderFunction = (info: CommandInfo) => string;

/**
 * Examples render options
 */
export interface ExamplesRenderOptions {
  /** Include heading (default: true) */
  withHeading?: boolean;
  /** Show execution output (default: true when results available) */
  showOutput?: boolean;
  /** Command prefix to prepend to example commands (e.g., "my-cli config get") */
  commandPrefix?: string;
}

/**
 * Default renderer customization options
 */
export interface DefaultRendererOptions {
  /** Heading level (default: 1) */
  headingLevel?: HeadingLevel;
  /** Option display style */
  optionStyle?: "table" | "list";
  /** Generate anchor links to subcommands */
  generateAnchors?: boolean;
  /** Include subcommand details */
  includeSubcommandDetails?: boolean;
}

/**
 * Root document configuration
 * The root document contains global options tables and command index sections.
 */
export interface RootDocConfig {
  /** Output file path */
  path: string;
  /**
   * Global options configuration.
   * ArgsShape directly, or { args, options } for render options.
   */
  globalOptions?: ArgsShape | { args: ArgsShape; options?: ArgsTableOptions };
  /** Heading level for the file header (default: 1) */
  headingLevel?: HeadingLevel;
  /** Index section rendering options */
  index?: CommandIndexOptions;
  /**
   * Custom layout for the root document. When absent, a default layout is used
   * (title/description header, then global options, then index, then commands).
   * The layout composes markerless markdown via the `md` tag; the only markers
   * emitted are the per-command marker pairs inside `md.commands()`.
   */
  layout?: (md: LayoutMd) => string;
}

/**
 * Path configuration for documentation output.
 * Simpler alternative to FileMapping for common patterns.
 *
 * @example
 * // All commands in one file
 * path: "docs/CLI.md"
 *
 * // Split files: root + specific commands in separate files
 * path: { root: "docs/CLI.md", commands: { "build": "docs/build.md" } }
 */
export type PathConfig = string | { root: string; commands?: Record<string, string> };

/**
 * A per-command override. `true` selects the default command render; a function
 * composes markerless markdown for the command via the `md` tag.
 */
export type CommandOverride = true | ((md: CommandMd) => string);

/**
 * Flat per-command map: command path -> override.
 *
 * @example
 * { "": true, "build": (md) => md`${md.usage}\n\n${md.options}` }
 */
export type CommandMap = Record<string, CommandOverride>;

/**
 * Per-file configuration. Every value in a {@link FileMapping} is a
 * `FileConfig`, so there is no value-level ambiguity to disambiguate.
 */
export interface FileConfig {
  /**
   * Commands to include in this file. The array form lists command paths that
   * each use the default render; the map form ({@link CommandMap}) allows
   * per-command overrides. Array vs. object is the only (reliable) distinction.
   */
  commands?: string[] | CommandMap;
  /**
   * Custom layout for this file. When absent, the default layout simply emits
   * the file's command blocks (`md.commands()`).
   */
  layout?: (md: LayoutMd) => string;
  /**
   * Curated label for this file's entry in the root document command index
   * (`md.index`). When omitted, the index derives the title/description from the
   * file's first command. Use this to keep a hand-written category title (e.g.
   * "Application Commands") instead of the raw command name.
   */
  index?: { title?: string; description?: string };
  /** Skip subcommand expansion (commands are used as-is). @internal */
  noExpand?: boolean;
}

/**
 * File mapping configuration.
 * Key: output file path (e.g., "docs/cli.md").
 * Value: a {@link FileConfig}. Put command paths under `commands` (an array for
 * default renders, or a {@link CommandMap} for per-command overrides) and an
 * optional `layout`.
 *
 * @example
 * // Default renders for several commands
 * { "docs/cli.md": { commands: ["", "user", "config"] } }
 *
 * // Per-command overrides
 * { "docs/cli.md": { commands: { "": true, "build": (md) => md`${md.usage}` } } }
 *
 * // A custom file layout
 * { "docs/cli.md": { commands: [""], layout: (md) => md`...` } }
 */
export type FileMapping = Record<string, FileConfig>;

/**
 * generateDoc configuration
 */
export interface GenerateDocConfig {
  /** Command to generate documentation for */
  command: AnyCommand;
  /**
   * Root document configuration.
   * The root document contains global options tables and command index sections.
   * Title and description are derived from `command.name` and `command.description`.
   */
  rootDoc?: RootDocConfig;
  /**
   * Path configuration (simpler alternative to files).
   * Mutually exclusive with `files`.
   */
  path?: PathConfig;
  /** File output configuration (command path -> file mapping) */
  files?: FileMapping;
  /** Command paths to ignore (including their subcommands) */
  ignores?: string[];
  /** Default renderer display options (heading level, option style, anchors) */
  format?: DefaultRendererOptions;
  /** Formatter function to apply to generated content before comparison */
  formatter?: FormatterFunction;
  /** Example execution configuration (per command path) */
  examples?: ExampleConfig;
  /**
   * Target command paths to validate (e.g., ["read", "config get"])
   * When specified, only these commands' sections are validated.
   * The full document structure is used to maintain cross-file links.
   */
  targetCommands?: string[];
  /**
   * Global args schema (runtime schema alternative).
   * When provided, automatically derives `rootDoc.globalOptions` from this schema.
   */
  globalArgs?: ArgsSchema;
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
 * Formatter function type
 * Formats generated content before comparison
 */
export type FormatterFunction = (content: string) => string | Promise<string>;

/**
 * Environment variable name for update mode
 */
export const UPDATE_GOLDEN_ENV = "POLITTY_DOCS_UPDATE";

/**
 * Marker prefix for command markers in generated documentation.
 * Format: <!-- politty:command:<path>:start --> ... <!-- politty:command:<path>:end -->
 */
export const SECTION_MARKER_PREFIX = "politty:command";

/**
 * Generate the start marker that wraps a single command block.
 */
export function commandStartMarker(commandPath: string): string {
  return `<!-- ${SECTION_MARKER_PREFIX}:${commandPath}:start -->`;
}

/**
 * Generate the end marker that wraps a single command block.
 */
export function commandEndMarker(commandPath: string): string {
  return `<!-- ${SECTION_MARKER_PREFIX}:${commandPath}:end -->`;
}
