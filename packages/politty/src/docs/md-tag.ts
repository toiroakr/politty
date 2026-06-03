import {
  renderArgumentsSection,
  renderDescriptionSection,
  renderExamplesSection,
  renderGlobalOptionsLinkSection,
  renderNotesSection,
  renderOptionsSection,
  renderSubcommandsSection,
  renderUsageSection,
} from "./default-renderers.js";
import type { CommandInfo } from "./types.js";

/**
 * Core formatting for the `md` tagged template used by doc templates.
 *
 * Behavior:
 * - Dedent: removes the common leading indentation introduced by writing the
 *   template literal at some indentation level in source code.
 * - Trim: strips leading blank lines and trailing whitespace.
 * - Collapse: squeezes 3+ consecutive newlines into a single blank line, so an
 *   empty interpolation (e.g. an absent section) does not leave a gap.
 *
 * Indentation is computed only from lines whose leading whitespace is followed
 * by non-whitespace (`/^([ \t]+)\S/`). Column-0 lines coming from multi-line
 * interpolated values therefore never lower the common indent, and the strip
 * step only removes leading whitespace, never interpolated content.
 */
export function formatTemplate(
  strings: TemplateStringsArray | readonly string[],
  values: readonly unknown[],
): string {
  // 1. Interleave literal parts and interpolated values.
  let result = "";
  for (let i = 0; i < strings.length; i++) {
    result += strings[i] ?? "";
    if (i < values.length) {
      result += stringifyValue(values[i]);
    }
  }

  // 2. Compute the common indentation across indented content lines.
  let mindent: number | null = null;
  for (const line of result.split("\n")) {
    const match = line.match(/^([ \t]+)\S/);
    if (match) {
      const indent = match[1]!.length;
      mindent = mindent === null ? indent : Math.min(mindent, indent);
    }
  }

  // 3. Strip the common indentation from the start of every line.
  if (mindent !== null && mindent > 0) {
    result = result.replace(new RegExp(`^[ \\t]{${mindent}}`, "gm"), "");
  }

  // 4. Drop leading blank lines and trailing whitespace.
  result = result.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");

  // 5. Collapse runs of blank lines into a single blank line.
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}

/**
 * Stringify an interpolated value. Nullish values render as empty strings so
 * absent sections collapse cleanly.
 */
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

/**
 * The tag function shape: callable as a tagged template, returning the
 * formatted markdown string.
 */
export type MdTagFn = (strings: TemplateStringsArray, ...values: unknown[]) => string;

/**
 * `md` tag bound to a single command. Exposes that command's generated
 * sections as getters and a heading helper.
 */
export type CommandMd = MdTagFn & {
  /** Description text (plus an Aliases line when present). */
  readonly description: string;
  /** Usage section (`**Usage**` + fenced command line). */
  readonly usage: string;
  /** Arguments section, or "" when there are no positional args. */
  readonly arguments: string;
  /** Options section, or "" when there are no options. */
  readonly options: string;
  /** "See Global Options" link, or "" when it does not apply. */
  readonly globalOptionsLink: string;
  /** Subcommands section, or "" when there are none. */
  readonly subcommands: string;
  /** Examples section, or "" when there are none. */
  readonly examples: string;
  /** Notes section, or "" when there are none. */
  readonly notes: string;
  /**
   * Heading for this command at a relative level (>= 1). `h(1)` is the
   * command's base level in the file; `h(2)` is one level deeper. Pass `text`
   * to emit an arbitrary heading instead of the command name.
   */
  h(level: number, text?: string): string;
};

/**
 * `md` tag for a file-level layout. Exposes `commands()` (the file's rendered
 * command blocks) and, on the root document, the global-options table and the
 * command index.
 */
export type LayoutMd = MdTagFn & {
  /** Render all command blocks belonging to this file, in order. */
  commands(): string;
  /** Global options table (root document only; "" otherwise). */
  readonly globalOptions: string;
  /** Command index (root document only; "" otherwise). */
  readonly index: string;
};

/** Options controlling how a command's sections render. */
export interface CommandMdOptions {
  /** Effective heading level for this command's title (file-adjusted). */
  baseHeadingLevel?: number;
  /** Option/argument display style. */
  optionStyle?: "table" | "list";
  /** Generate anchor links in the subcommands table. */
  generateAnchors?: boolean;
  /** Include subcommand detail anchors. */
  includeSubcommandDetails?: boolean;
}

/**
 * Build a `md` tag bound to a single command.
 */
export function createCommandMd(info: CommandInfo, options: CommandMdOptions = {}): CommandMd {
  const {
    baseHeadingLevel = 1,
    optionStyle = "table",
    generateAnchors = true,
    includeSubcommandDetails = true,
  } = options;

  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    formatTemplate(strings, values)) as CommandMd;

  Object.defineProperties(tag, {
    description: { get: () => renderDescriptionSection(info), enumerable: true },
    usage: { get: () => renderUsageSection(info), enumerable: true },
    arguments: { get: () => renderArgumentsSection(info, optionStyle), enumerable: true },
    options: { get: () => renderOptionsSection(info, optionStyle), enumerable: true },
    globalOptionsLink: { get: () => renderGlobalOptionsLinkSection(info), enumerable: true },
    subcommands: {
      get: () => renderSubcommandsSection(info, { generateAnchors, includeSubcommandDetails }),
      enumerable: true,
    },
    examples: { get: () => renderExamplesSection(info), enumerable: true },
    notes: { get: () => renderNotesSection(info), enumerable: true },
  });

  tag.h = (level: number, text?: string): string => {
    const effective = Math.min(Math.max(1, baseHeadingLevel + (level - 1)), 6);
    const label = text ?? (info.commandPath || info.name);
    return `${"#".repeat(effective)} ${label}`;
  };

  return tag;
}

/** Inputs for building a layout `md` tag. */
export interface LayoutMdInputs {
  /** Renders the file's command blocks (in order). */
  commands: () => string;
  /** Global options table markdown (root document only). */
  globalOptions?: string;
  /** Command index markdown (root document only). */
  index?: string;
}

/**
 * Build a `md` tag for a file layout.
 */
export function createLayoutMd(inputs: LayoutMdInputs): LayoutMd {
  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    formatTemplate(strings, values)) as LayoutMd;

  tag.commands = () => inputs.commands();
  Object.defineProperties(tag, {
    globalOptions: { get: () => inputs.globalOptions ?? "", enumerable: true },
    index: { get: () => inputs.index ?? "", enumerable: true },
  });

  return tag;
}
