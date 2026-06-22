import type { StandardSchemaV1 } from "@standard-schema/spec";
import { extractShapeFields, type ResolvedFieldMeta } from "../core/schema-extractor.js";
import { type ColumnId, emitMarkdownTable, toOptionRows } from "./option-rows.js";

/**
 * Args shape type (Record of string keys to arg schemas).
 * This matches the typical structure of `commonArgs`, `workspaceArgs`, etc.
 * Any Standard Schema library (Zod, Valibot, ArkType, ...) is accepted.
 */
export type ArgsShape = Record<string, StandardSchemaV1>;

/**
 * Options for rendering args table
 */
export type ArgsTableOptions = {
  /** Columns to include in the table (default: all columns) */
  columns?: ColumnId[];
};

/**
 * Extract ResolvedFieldMeta array from ArgsShape
 *
 * This converts a raw args shape (like `commonArgs`) into the
 * ResolvedFieldMeta format used by politty's rendering functions.
 */
function extractArgsFields(args: ArgsShape): ResolvedFieldMeta[] {
  return extractShapeFields(args);
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

  // Both the default and column-filtered paths share the same (rows × columns)
  // intermediate; passing `columns` simply restricts/reorders the emitted columns.
  return emitMarkdownTable(toOptionRows(optionFields), options?.columns);
}
