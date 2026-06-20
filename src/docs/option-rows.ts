import type { ResolvedFieldMeta } from "../core/schema-extractor.js";

/**
 * Column identifiers for the options markdown table, in their canonical order.
 */
export type ColumnId = "option" | "alias" | "description" | "required" | "default" | "env";

/** Canonical column order used when no explicit column subset is requested. */
const DEFAULT_COLUMNS: ColumnId[] = ["option", "alias", "description", "required", "default"];

/**
 * A separate row emitted for a custom negation flag that carries its own
 * description (e.g. `--monochrome` with `negationDescription` set).
 */
export type NegationRow = {
  /** Negation flag including the `--` prefix, no backticks (e.g. `--disable-cache`). */
  flag: string;
  /** Raw (unescaped) description, without the relation marker. */
  description: string;
  /** Marker pointing back at the positive flag, e.g. ``(↔ `--color`)``. */
  relationMarker: string;
  /** Mirrors the parent option's required flag (used by the table's Required cell). */
  required: boolean;
};

/**
 * Normalized, format-agnostic view of a single option. Both the markdown
 * table and list emitters consume this, so the "decide what to display"
 * logic (negation handling, alias ordering, placeholder resolution, boolean
 * vs. value form) lives in {@link toOptionRows} alone.
 *
 * Flag strings are stored without backticks; each emitter applies its own
 * quoting/escaping.
 */
export type OptionRow = {
  /** Long flag including placeholder for value options, no backticks (e.g. `--port <PORT>`, `--cache`). */
  longFlag: string;
  /** Alias flag tokens with their `-`/`--` prefix, in declaration order (e.g. `["-v", "--verbose"]`). */
  aliases: string[];
  /**
   * Inline negation flag with `--` prefix (e.g. `--disable-cache`) shown joined
   * to the positive flag when the negation has no dedicated description.
   */
  inlineNegation?: string | undefined;
  /** Raw (unescaped) description. */
  description?: string | undefined;
  required: boolean;
  /** Whether a default value is present. */
  hasDefault: boolean;
  /** Raw default value (only meaningful when {@link hasDefault} is true). */
  defaultValue?: unknown;
  /** Environment variable name(s). */
  env?: string | string[] | undefined;
  /** Separate row for a custom negation that carries its own description. */
  negationRow?: NegationRow | undefined;
};

/**
 * Marker appended to a custom negation row/line so readers can see which
 * positive flag it negates (e.g. `--monochrome` → ``(↔ `--color`)``).
 */
function negationRelationMarker(opt: ResolvedFieldMeta): string {
  return `(↔ \`--${opt.cliName}\`)`;
}

/**
 * Resolve placeholder for an option (uses kebab-case cliName).
 */
function resolvePlaceholder(opt: ResolvedFieldMeta): string {
  return opt.placeholder ?? opt.cliName.toUpperCase().replace(/-/g, "_");
}

/**
 * Normalize a single {@link ResolvedFieldMeta} into an {@link OptionRow}.
 */
function toOptionRow(opt: ResolvedFieldMeta): OptionRow {
  const longFlag =
    opt.type === "boolean" ? `--${opt.cliName}` : `--${opt.cliName} <${resolvePlaceholder(opt)}>`;

  const aliases: string[] = [];
  if (opt.alias) {
    for (const a of opt.alias) {
      aliases.push(a.length === 1 ? `-${a}` : `--${a}`);
    }
  }

  const hasNegationDisplay = opt.type === "boolean" && !!opt.negationDisplay;
  const inlineNegation =
    hasNegationDisplay && !opt.negationDescription ? `--${opt.negationDisplay}` : undefined;
  const negationRow: NegationRow | undefined =
    hasNegationDisplay && opt.negationDescription
      ? {
          flag: `--${opt.negationDisplay}`,
          description: opt.negationDescription,
          relationMarker: negationRelationMarker(opt),
          required: opt.required,
        }
      : undefined;

  return {
    longFlag,
    aliases,
    inlineNegation,
    description: opt.description,
    required: opt.required,
    hasDefault: opt.defaultValue !== undefined,
    defaultValue: opt.defaultValue,
    env: opt.env,
    negationRow,
  };
}

/**
 * Build the normalized intermediate representation for a list of options.
 * This is the single source of truth for per-option display decisions; the
 * emitters below ({@link emitMarkdownTable}, {@link emitMarkdownList}) are pure
 * formatting.
 */
export function toOptionRows(options: ResolvedFieldMeta[]): OptionRow[] {
  return options.map(toOptionRow);
}

/**
 * Escape markdown special characters in table cells.
 */
function escapeTableCell(str: string): string {
  return str.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function backtick(value: string): string {
  return `\`${value}\``;
}

/**
 * Format default value for table display.
 */
function formatDefaultValue(row: OptionRow): string {
  if (!row.hasDefault) {
    return "-";
  }
  return `\`${JSON.stringify(row.defaultValue)}\``;
}

/**
 * Format env variable names for a markdown table cell.
 */
function formatEnvNames(env: string | string[] | undefined): string {
  if (!env) return "-";
  if (Array.isArray(env)) {
    return env.map((e) => `\`${e}\``).join(", ");
  }
  return `\`${env}\``;
}

/**
 * Format env variable info for a markdown list item (e.g. `[env: PORT, SERVER_PORT]`).
 */
function formatEnvInfo(env: string | string[] | undefined): string {
  if (!env) return "";
  const envNames = Array.isArray(env) ? env : [env];
  return ` [env: ${envNames.join(", ")}]`;
}

/** Header label + separator dashes for each column, matching legacy widths. */
const COLUMN_META: Record<ColumnId, { header: string; separator: string }> = {
  option: { header: "Option", separator: "--------" },
  alias: { header: "Alias", separator: "-------" },
  description: { header: "Description", separator: "-------------" },
  required: { header: "Required", separator: "----------" },
  default: { header: "Default", separator: "---------" },
  env: { header: "Env", separator: "-----" },
};

/**
 * Render the table cell for a base option row in the given column.
 */
function tableCell(row: OptionRow, col: ColumnId): string {
  switch (col) {
    case "option": {
      const name = backtick(row.longFlag);
      return row.inlineNegation ? `${name} / ${backtick(row.inlineNegation)}` : name;
    }
    case "alias":
      return row.aliases.length > 0 ? row.aliases.map(backtick).join(", ") : "-";
    case "description":
      return escapeTableCell(row.description ?? "");
    case "required":
      return row.required ? "Yes" : "No";
    case "default":
      return formatDefaultValue(row);
    case "env":
      return formatEnvNames(row.env);
  }
}

/**
 * Render the table cell for a negation row in the given column.
 */
function negationTableCell(neg: NegationRow, col: ColumnId): string {
  switch (col) {
    case "option":
      return backtick(neg.flag);
    case "description":
      return `${escapeTableCell(neg.description)} ${neg.relationMarker}`;
    case "required":
      return neg.required ? "Yes" : "No";
    case "alias":
    case "default":
    case "env":
      return "-";
  }
}

/**
 * Emit option rows as a markdown table.
 *
 * When `columns` is omitted, the canonical column set is used and the `Env`
 * column is appended automatically iff any row has env configured. When
 * `columns` is provided, exactly those columns are emitted, in that order.
 */
export function emitMarkdownTable(rows: OptionRow[], columns?: ColumnId[]): string {
  if (rows.length === 0) {
    return "";
  }

  const cols =
    columns ??
    (rows.some((r) => r.env) ? [...DEFAULT_COLUMNS, "env" as ColumnId] : DEFAULT_COLUMNS);

  const lines: string[] = [];
  lines.push(`| ${cols.map((c) => COLUMN_META[c].header).join(" | ")} |`);
  lines.push(`|${cols.map((c) => COLUMN_META[c].separator).join("|")}|`);

  for (const row of rows) {
    lines.push(`| ${cols.map((c) => tableCell(row, c)).join(" | ")} |`);
    if (row.negationRow) {
      lines.push(`| ${cols.map((c) => negationTableCell(row.negationRow!, c)).join(" | ")} |`);
    }
  }

  return lines.join("\n");
}

/**
 * Emit option rows as a markdown list.
 *
 * Aliases are joined with `, ` (short flags first, then the long flag, then
 * long aliases); the inline negation is appended with ` / ` so it stays
 * visually distinct from aliases.
 */
export function emitMarkdownList(rows: OptionRow[]): string {
  if (rows.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (const row of rows) {
    const shortAliases = row.aliases.filter((a) => !a.startsWith("--"));
    const longAliases = row.aliases.filter((a) => a.startsWith("--"));
    const flagParts = [...shortAliases, row.longFlag, ...longAliases].map(backtick);
    let flags = flagParts.join(", ");
    if (row.inlineNegation) {
      flags += ` / ${backtick(row.inlineNegation)}`;
    }

    const desc = row.description ? ` - ${row.description}` : "";
    const required = row.required ? " (required)" : "";
    const defaultVal = row.hasDefault ? ` (default: ${JSON.stringify(row.defaultValue)})` : "";
    const envInfo = formatEnvInfo(row.env);
    lines.push(`- ${flags}${desc}${required}${defaultVal}${envInfo}`);

    if (row.negationRow) {
      lines.push(
        `- ${backtick(row.negationRow.flag)} - ${row.negationRow.description} ${row.negationRow.relationMarker}`,
      );
    }
  }

  return lines.join("\n");
}
