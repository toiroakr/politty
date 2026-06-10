/**
 * Generate NEW-format config fragments from a parsed OLD document.
 *
 * For each command region we decide:
 *   - pure default (its sections are exactly what the default renderer emits in
 *     order, no extra prose) => emit `true`;
 *   - customized (extra free text, reordered, or a hand-edited section) => emit
 *     a `(md) => md\`...\`` override template where generated sections become
 *     `${md.usage}` etc. and free text is preserved as literal markdown.
 *
 * File-level elements (root header/footer free text, the global-options block,
 * the command index) collapse into a `rootDoc.layout` / file `layout` template
 * using `md.globalOptions`, `md.index`, and `md.commands()`.
 *
 * The "pure default" decision is intentionally STRUCTURAL, not byte-exact:
 * gen-config cannot run the renderer (it has no live command object), so it
 * treats a region as default when every section maps 1:1 to a known generated
 * section type with no interleaved free text. The `verify` step is what proves
 * byte-identity after the real generator re-runs.
 */

import ts from "typescript";
import { resolveConstInitializer } from "./parse-config.js";
import type {
  OldCommandRegion,
  OldFileElements,
  OldSectionType,
  ParsedOldDoc,
} from "./parse-doc.js";

/** Map an OLD section type to the `md` getter that regenerates it. */
const SECTION_TO_MD: Record<OldSectionType, string | null> = {
  heading: "md.h(1)",
  description: "md.description",
  usage: "md.usage",
  arguments: "md.arguments",
  options: "md.options",
  "global-options-link": "md.globalOptionsLink",
  subcommands: "md.subcommands",
  examples: "md.examples",
  notes: "md.notes",
};

/** The canonical default order of generated sections. */
const DEFAULT_ORDER: OldSectionType[] = [
  "heading",
  "description",
  "usage",
  "arguments",
  "options",
  "global-options-link",
  "subcommands",
  "examples",
  "notes",
];

/**
 * Escape a markdown literal for safe embedding inside a `md\`...\`` tagged
 * template: backticks and `${` must be escaped, and lone backslashes preserved.
 */
export function escapeTemplateLiteral(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/** Per-command generation outcome. */
export interface CommandConfigResult {
  scope: string;
  /** `"true"` or the full `(md) => md\`...\`` source text. */
  code: string;
  /** Whether this is a pure-default `true`. */
  isDefault: boolean;
}

/**
 * Decide whether a command region is pure-default.
 *
 * Pure default ⇔ no inter-section free text AND the sections are a contiguous
 * prefix-respecting subsequence of the default order (sections may be absent —
 * e.g. a command with no arguments — but never reordered, duplicated, or
 * carrying unknown content beyond the section body).
 */
export function isPureDefault(region: OldCommandRegion): boolean {
  if (region.interSectionText.trim().length > 0) return false;
  if (region.sections.length === 0) return false;

  const seenTypes = region.sections.map((s) => s.type);
  // Reject duplicates.
  if (new Set(seenTypes).size !== seenTypes.length) return false;
  // Must follow the canonical order.
  let cursor = -1;
  for (const t of seenTypes) {
    const idx = DEFAULT_ORDER.indexOf(t);
    if (idx <= cursor) return false;
    cursor = idx;
  }
  return true;
}

/**
 * Build the `(md) => md\`...\`` override body for a customized command.
 *
 * Generated section bodies become `${md.<section>}`; everything else (the
 * inter-section free text) is preserved verbatim as escaped literal markdown,
 * keeping the original ordering as it appeared in the OLD document.
 */
export function buildCommandOverride(region: OldCommandRegion): string {
  // Build a positioned list of fragments: every section (as `${md.*}` or a
  // literal for unknown types) plus every inter-section free-text chunk, sorted
  // by their original char offset so prose threads back between the correct
  // sections rather than being appended at the end.
  const fragments: Array<{ position: number; text: string }> = [];
  for (const section of region.sections) {
    const mdExpr = SECTION_TO_MD[section.type];
    fragments.push({
      position: section.position,
      text: mdExpr ? `\${${mdExpr}}` : escapeTemplateLiteral(section.content),
    });
  }
  for (const chunk of region.interSectionChunks) {
    fragments.push({ position: chunk.position, text: escapeTemplateLiteral(chunk.text) });
  }
  fragments.sort((a, b) => a.position - b.position);
  const body = fragments.map((f) => f.text).join("\n\n");
  return `(md) =>\n  md\`\n${indent(body, 4)}\n  \``;
}

/** Generate the per-command config map entries. */
export function generateCommandConfigs(doc: ParsedOldDoc): CommandConfigResult[] {
  return doc.commands.map((region) => {
    if (isPureDefault(region)) {
      return { scope: region.scope, code: "true", isDefault: true };
    }
    return { scope: region.scope, code: buildCommandOverride(region), isDefault: false };
  });
}

/**
 * Build a `rootDoc.layout` template from the OLD file-level elements.
 *
 * Threads root header free text, the `md.globalOptions` table, the `md.index`,
 * any root footer, and `md.commands()` into a single markerless layout. Free
 * text around the OLD global-options / index markers is preserved verbatim.
 *
 * `hasGlobalOptions` / `hasIndex` control whether the corresponding `md.*`
 * getters are emitted.
 */
export interface LayoutTemplateInput {
  /** Free text chunks in document order (root header / prose / footer). */
  freeText: string[];
  hasGlobalOptions: boolean;
  hasIndex: boolean;
  /** Whether this layout owns the command blocks (root file) or is index-only. */
  includeCommands: boolean;
}

export function buildRootLayout(input: LayoutTemplateInput): string {
  const lines: string[] = [];
  // Header free text first (typically title + description prose).
  for (const chunk of input.freeText) {
    lines.push(escapeTemplateLiteral(chunk));
  }
  if (input.hasGlobalOptions) lines.push("${md.globalOptions}");
  if (input.hasIndex) lines.push("${md.index}");
  if (input.includeCommands) lines.push("${md.commands()}");
  const body = lines.join("\n\n");
  return `(md) =>\n  md\`\n${indent(body, 4)}\n  \``;
}

/**
 * Build a positionally-faithful `rootDoc.layout` template directly from a
 * parsed OLD document. Root header/footer prose, free text around the
 * global-options / index markers, and the `md.globalOptions` / `md.index`
 * getters are interleaved in their ORIGINAL document order so the regenerated
 * markerless doc matches the old layout byte-for-byte (modulo markers).
 *
 * When the document has no index marker, `md.commands()` is appended so the
 * per-command blocks are still rendered.
 */
export function buildLayoutFromDoc(doc: ParsedOldDoc): string {
  const file: OldFileElements = doc.file;
  const fragments: Array<{ position: number; text: string }> = [];

  // Free text outside every marker (root header/footer prose, section
  // headings like "## Global Options").
  for (const chunk of doc.freeText) {
    fragments.push({ position: chunk.position, text: escapeTemplateLiteral(chunk.text) });
  }
  // Root header / footer blocks (their inner prose is literal).
  if (file.rootHeader !== undefined && file.rootHeaderPosition !== undefined) {
    fragments.push({
      position: file.rootHeaderPosition,
      text: escapeTemplateLiteral(file.rootHeader),
    });
  }
  if (file.rootFooter !== undefined && file.rootFooterPosition !== undefined) {
    fragments.push({
      position: file.rootFooterPosition,
      text: escapeTemplateLiteral(file.rootFooter),
    });
  }
  if (file.globalOptions !== undefined && file.globalOptionsPosition !== undefined) {
    fragments.push({ position: file.globalOptionsPosition, text: "${md.globalOptions}" });
  }
  if (file.index !== undefined && file.indexPosition !== undefined) {
    fragments.push({ position: file.indexPosition, text: "${md.index}" });
  }

  fragments.sort((a, b) => a.position - b.position);
  const lines = fragments.map((f) => f.text);
  // If there is no index, the layout still owns the command blocks.
  if (file.index === undefined) lines.push("${md.commands()}");

  const body = lines.join("\n\n");
  return `(md) =>\n  md\`\n${indent(body, 4)}\n  \``;
}

// ---------------------------------------------------------------------------
// Static FileConfig migration: { title?, description?, commands, render?, ... }
// ---------------------------------------------------------------------------

/**
 * Read a string-literal initializer (single- or no-substitution-template),
 * returning its textual value, or `undefined` when the initializer is not a
 * plain string literal (e.g. an expression we cannot statically inline).
 */
function readStringLiteral(node: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  return undefined;
}

/**
 * Decide whether a `render:` initializer is a default-equivalent
 * `createCommandRenderer(...)` call (no options, `{}`, or `{ headingLevel: 1 }`)
 * which the NEW default renderer already covers and can be DROPPED.
 *
 * Anything else (a custom function, an identifier we cannot prove default such
 * as `defaultRender` bound elsewhere, or a renderer with non-default options)
 * is NOT droppable and forces a `layout-review` TODO.
 */
export function isDefaultRenderInitializer(node: ts.Expression, sf: ts.SourceFile): boolean {
  // Resolve a same-file `const x = createCommandRenderer(...)` one level so a
  // shared `render: defaultRender` binding can be proven default-equivalent.
  let resolved: ts.Expression = node;
  if (ts.isIdentifier(node)) {
    const init = resolveConstInitializer(sf, node.text);
    if (!init) return false;
    resolved = init;
  }
  node = resolved;
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  const calleeName = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined;
  if (calleeName !== "createCommandRenderer") return false;
  const arg = node.arguments[0];
  if (!arg) return true; // createCommandRenderer()
  if (!ts.isObjectLiteralExpression(arg)) return false;
  // Only default-equivalent display options allowed: {} or { headingLevel: 1 }.
  for (const p of arg.properties) {
    if (!ts.isPropertyAssignment(p)) return false;
    const name =
      ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name) ? p.name.text : undefined;
    if (name === "headingLevel") {
      if (!(ts.isNumericLiteral(p.initializer) && p.initializer.text === "1")) return false;
    } else {
      return false;
    }
  }
  return true;
}

export interface FileConfigMigration {
  /** New source text for the FileConfig object literal. */
  text: string;
  /** layout-review TODO detail when a custom `render` could not be dropped. */
  layoutReview?: string;
  /**
   * variable-ref TODO detail when title/description referenced a non-literal
   * value (we cannot statically inline it into the layout).
   */
  variableRef?: string;
}

/**
 * Statically migrate a single FileConfig object literal `{ title?, description?,
 * commands, render?, ... }` into the NEW shape:
 *   - title/description -> `layout: (md) => md\`# <title>\n\n<description>\n\n${md.commands()}\``
 *   - default-equivalent `render` -> dropped
 *   - custom `render` -> dropped from the literal BUT a `layout-review` TODO is
 *     emitted (the default command blocks stay; the custom renderer must be
 *     reproduced via per-command overrides)
 *   - removed keys (title/description/render) are stripped
 *   - all other keys (commands, noExpand, …) are preserved verbatim
 *
 * Returns `undefined` when the node is not an object literal (caller falls back
 * to a TODO).
 */
export function migrateFileConfig(
  node: ts.ObjectLiteralExpression,
  sf: ts.SourceFile,
  indentSpaces = 4,
): FileConfigMigration {
  let title: string | undefined;
  let description: string | undefined;
  let titleDynamic = false;
  let descriptionDynamic = false;
  let layoutReview: string | undefined;
  const kept: string[] = [];

  for (const prop of node.properties) {
    if (ts.isSpreadAssignment(prop)) {
      kept.push(prop.getText(sf));
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) {
      kept.push(prop.getText(sf));
      continue;
    }
    const key =
      ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name) ? prop.name.text : undefined;
    if (key === "title") {
      const v = readStringLiteral(prop.initializer);
      if (v === undefined) titleDynamic = true;
      else title = v;
      continue;
    }
    if (key === "description") {
      const v = readStringLiteral(prop.initializer);
      if (v === undefined) descriptionDynamic = true;
      else description = v;
      continue;
    }
    if (key === "render") {
      if (!isDefaultRenderInitializer(prop.initializer, sf)) {
        layoutReview =
          "custom `render` was removed; the default command blocks are kept — reproduce the custom renderer via per-command `(md) => ...` overrides on `commands`";
      }
      continue;
    }
    // Preserve everything else verbatim (commands, noExpand, …).
    kept.push(prop.getText(sf));
  }

  let variableRef: string | undefined;
  if (titleDynamic || descriptionDynamic) {
    variableRef =
      "`title`/`description` referenced a non-literal value; inline it into the generated `layout` manually";
  }

  // Build the layout from title/description when present.
  const layoutLines: string[] = [];
  if (title !== undefined) layoutLines.push(`# ${escapeTemplateLiteral(title)}`);
  if (description !== undefined) layoutLines.push(escapeTemplateLiteral(description));
  layoutLines.push("${md.commands()}");

  const pad = " ".repeat(indentSpaces);
  const innerPad = " ".repeat(indentSpaces + 2);
  const bodyPad = " ".repeat(indentSpaces + 4);
  const hasLayout = title !== undefined || description !== undefined;

  const parts: string[] = [];
  for (const k of kept) {
    // Re-indent multi-line kept values to sit at innerPad.
    parts.push(`${innerPad}${k},`);
  }
  // The OLD `title`/`description` drove the ROOT command index entry, so carry
  // them to the NEW `FileConfig.index` label (the file-body heading is handled
  // by `layout` below). Without this the index would regress to the first
  // command's raw name/description.
  if (title !== undefined || description !== undefined) {
    const idx: string[] = [];
    if (title !== undefined) idx.push(`title: ${JSON.stringify(title)}`);
    if (description !== undefined) idx.push(`description: ${JSON.stringify(description)}`);
    parts.push(`${innerPad}index: { ${idx.join(", ")} },`);
  }
  if (hasLayout) {
    const layoutBody = layoutLines.map((l) => (l.length ? bodyPad + l : l)).join("\n\n");
    const layout = `(md) =>\n${innerPad}  md\`\n${layoutBody}\n${innerPad}  \``;
    parts.push(`${innerPad}layout: ${layout},`);
  }

  const text = `{\n${parts.join("\n")}\n${pad}}`;
  const out: FileConfigMigration = { text };
  if (layoutReview !== undefined) out.layoutReview = layoutReview;
  if (variableRef !== undefined) out.variableRef = variableRef;
  return out;
}

/** Indent every line of `text` by `n` spaces. */
function indent(text: string, n: number): string {
  const pad = " ".repeat(n);
  return text
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

/**
 * Render a NEW `files` CommandMap fragment (TS source) from per-command results.
 */
export function renderCommandMap(results: CommandConfigResult[]): string {
  const entries = results.map((r) => {
    const key = JSON.stringify(r.scope);
    if (r.isDefault) return `  ${key}: true,`;
    // Indent the multi-line override.
    return `  ${key}: ${indent(r.code, 2).trimStart()},`;
  });
  return `{\n${entries.join("\n")}\n}`;
}
