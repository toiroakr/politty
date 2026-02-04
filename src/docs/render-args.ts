import { z } from "zod";
import { extractFields, type ResolvedFieldMeta } from "../core/schema-extractor.js";
import { renderOptionsTableFromArray } from "./default-renderers.js";

/**
 * Args shape type (Record of string keys to Zod schemas)
 * This matches the typical structure of `commonArgs`, `workspaceArgs`, etc.
 */
export type ArgsShape = Record<string, z.ZodType>;

/**
 * Options for rendering args table
 */
export type ArgsTableOptions = {
  /** Columns to include in the table (default: all columns) */
  columns?: ("option" | "alias" | "description" | "default" | "env")[];
};

/**
 * Extract ResolvedFieldMeta array from ArgsShape
 *
 * This converts a raw args shape (like `commonArgs`) into the
 * ResolvedFieldMeta format used by politty's rendering functions.
 */
function extractArgsFields(args: ArgsShape): ResolvedFieldMeta[] {
  // Wrap in z.object to use extractFields
  const schema = z.object(args);
  const extracted = extractFields(schema);
  return extracted.fields;
}

/**
 * Render args definition as a markdown options table
 *
 * This function takes raw args definitions (like `commonArgs`) and
 * renders them as a markdown table suitable for documentation.
 *
 * @example
 * import { renderArgsTable } from "politty/docs";
 * import { commonArgs, workspaceArgs } from "./args";
 *
 * const table = renderArgsTable({
 *   ...commonArgs,
 *   ...workspaceArgs,
 * });
 * // | Option | Alias | Description | Default |
 * // |--------|-------|-------------|---------|
 * // | `--env-file <ENV_FILE>` | `-e` | Path to environment file | - |
 * // ...
 *
 * @param args - Args shape (Record of string keys to Zod schemas with arg() metadata)
 * @param options - Rendering options
 * @returns Rendered markdown table string
 */
export function renderArgsTable(args: ArgsShape, options?: ArgsTableOptions): string {
  const fields = extractArgsFields(args);

  // Filter to non-positional args only (options)
  const optionFields = fields.filter((f) => !f.positional);

  if (optionFields.length === 0) {
    return "";
  }

  // Use existing renderOptionsTableFromArray for consistency
  // Note: column filtering is not yet supported by renderOptionsTableFromArray
  // If columns option is needed, we would need to implement custom rendering
  if (options?.columns) {
    return renderFilteredTable(optionFields, options.columns);
  }

  return renderOptionsTableFromArray(optionFields);
}

/**
 * Escape markdown special characters in table cells
 */
function escapeTableCell(str: string): string {
  return str.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Format default value for display
 */
function formatDefaultValue(value: unknown): string {
  if (value === undefined) {
    return "-";
  }
  return `\`${JSON.stringify(value)}\``;
}

/**
 * Render table with filtered columns
 */
function renderFilteredTable(
  options: ResolvedFieldMeta[],
  columns: ("option" | "alias" | "description" | "default" | "env")[],
): string {
  const lines: string[] = [];

  // Build header
  const headerCells: string[] = [];
  const separatorCells: string[] = [];

  for (const col of columns) {
    switch (col) {
      case "option":
        headerCells.push("Option");
        separatorCells.push("------");
        break;
      case "alias":
        headerCells.push("Alias");
        separatorCells.push("-----");
        break;
      case "description":
        headerCells.push("Description");
        separatorCells.push("-----------");
        break;
      case "default":
        headerCells.push("Default");
        separatorCells.push("-------");
        break;
      case "env":
        headerCells.push("Env");
        separatorCells.push("---");
        break;
    }
  }

  lines.push(`| ${headerCells.join(" | ")} |`);
  lines.push(`| ${separatorCells.join(" | ")} |`);

  // Build rows
  for (const opt of options) {
    const cells: string[] = [];

    for (const col of columns) {
      switch (col) {
        case "option": {
          const placeholder = opt.placeholder ?? opt.cliName.toUpperCase().replace(/-/g, "_");
          const optionName =
            opt.type === "boolean"
              ? `\`--${opt.cliName}\``
              : `\`--${opt.cliName} <${placeholder}>\``;
          cells.push(optionName);
          break;
        }
        case "alias":
          cells.push(opt.alias ? `\`-${opt.alias}\`` : "-");
          break;
        case "description":
          cells.push(escapeTableCell(opt.description ?? ""));
          break;
        case "default":
          cells.push(formatDefaultValue(opt.defaultValue));
          break;
        case "env": {
          const envNames = opt.env
            ? Array.isArray(opt.env)
              ? opt.env.map((e) => `\`${e}\``).join(", ")
              : `\`${opt.env}\``
            : "-";
          cells.push(envNames);
          break;
        }
      }
    }

    lines.push(`| ${cells.join(" | ")} |`);
  }

  return lines.join("\n");
}
