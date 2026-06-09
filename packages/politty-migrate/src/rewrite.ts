/**
 * Rewrite an OLD-shape doc config TS file into the NEW API.
 *
 * Strategy: text-splicing driven by the Compiler-API spans from
 * `parse-config.ts`. We never reprint the whole AST (that would reformat the
 * file); instead we surgically replace property values and remove deleted keys.
 *
 * When a config cannot be statically rewritten (spread of a shared base,
 * variable/function-derived values, computed keys), we perform BEST-EFFORT
 * edits and insert a `// TODO(politty-migrate: <category>)` anchor immediately
 * above the offending construct. Categories:
 *   - spread-config : `...base` in the config literal; the base may carry
 *     removed keys (rootInfo, render, …) that we cannot see here.
 *   - variable-ref  : the config (or a value) is a bare identifier / call.
 *   - dynamic-key   : a computed `[expr]` file-map key.
 *   - layout-review : a generated layout/override needs a human eye (free text
 *     placement, reordering).
 */

import ts from "typescript";
import { migrateFileConfig } from "./gen-config.js";
import type { ParseConfigResult, ParsedConfigCall } from "./parse-config.js";
import { extractProperties, getProperty, resolveConstObjectLiteral } from "./parse-config.js";

/** Keys removed by the NEW API; their presence forces edits / TODOs. */
export const REMOVED_CONFIG_KEYS = ["rootInfo"] as const;
export const REMOVED_FILECONFIG_KEYS = ["title", "description", "render"] as const;

export type TodoCategory = "spread-config" | "variable-ref" | "dynamic-key" | "layout-review";

export interface RewriteTodo {
  category: TodoCategory;
  detail: string;
  /** Char offset where the anchor was inserted (in the ORIGINAL source). */
  position: number;
}

export interface RewriteEdit {
  start: number;
  end: number;
  replacement: string;
}

export interface RewriteResult {
  /** The rewritten source text. */
  text: string;
  todos: RewriteTodo[];
  /**
   * NO-SILENT-MISS findings: leftover removed keys (title/description/render/
   * rootInfo) that survived the rewrite WITHOUT a nearby TODO anchor. A
   * non-empty list means the migration silently produced invalid config — this
   * MUST be empty for a successful migration.
   */
  silentMisses: SilentMiss[];
}

export interface SilentMiss {
  key: string;
  /** 1-based line in the rewritten text. */
  line: number;
  lineText: string;
}

/** A planned replacement of a config value, keyed by call. */
export interface ConfigReplacement {
  /** The call to edit. */
  call: ParsedConfigCall;
  /** New text for the `files` value, if rewriting it. */
  filesValue?: string;
  /** New text for `rootDoc` value, if rewriting it. */
  rootDocValue?: string;
  /** Layout-review note to attach. */
  layoutReview?: string;
}

/**
 * Apply a set of edits to a source string. Edits must not overlap; they are
 * applied right-to-left so offsets stay valid.
 */
export function applyEdits(text: string, edits: RewriteEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}

/** Compute the start-of-line offset for a given position. */
function lineStart(text: string, pos: number): number {
  const nl = text.lastIndexOf("\n", pos - 1);
  return nl + 1;
}

/** The indentation (leading whitespace) of the line containing `pos`. */
function indentOf(text: string, pos: number): string {
  const start = lineStart(text, pos);
  const m = text.slice(start).match(/^[ \t]*/);
  return m ? m[0] : "";
}

/**
 * Build a TODO anchor comment line for a category.
 */
export function todoAnchor(category: TodoCategory, detail: string, indent: string): string {
  return `${indent}// TODO(politty-migrate: ${category}) ${detail}\n`;
}

/**
 * Rewrite a single source file.
 *
 * @param parsed   parse-config result for the file
 * @param replacements  planned value replacements per call (from gen-config)
 */
export function rewriteSource(
  parsed: ParseConfigResult,
  replacements: ConfigReplacement[],
): RewriteResult {
  const sf = parsed.sourceFile;
  const original = sf.text;
  const edits: RewriteEdit[] = [];
  const todos: RewriteTodo[] = [];
  // Anchor insertions are tracked separately so multiple anchors on the same
  // line position do not collide with value edits.
  const anchorInserts: Array<{ pos: number; text: string }> = [];

  const seenAnchorPos = new Set<string>();
  const addTodo = (category: TodoCategory, detail: string, atPos: number) => {
    const ls = lineStart(original, atPos);
    const key = `${category}:${ls}`;
    if (seenAnchorPos.has(key)) {
      todos.push({ category, detail, position: ls });
      return;
    }
    seenAnchorPos.add(key);
    const indent = indentOf(original, atPos);
    anchorInserts.push({ pos: ls, text: todoAnchor(category, detail, indent) });
    todos.push({ category, detail, position: ls });
  };

  /**
   * Statically migrate every FileConfig entry inside a `files` object literal
   * (whether inline at the call site or resolved from a `const files = {...}`).
   * Each entry whose value is an object literal carrying removed keys
   * (title/description/render) is rewritten in place to a NEW FileConfig with a
   * `layout`. Entries whose value is a non-object (array/identifier/call) are
   * left alone. Returns true if any entry was migrated.
   */
  const migrateFilesObject = (filesObj: ts.ObjectLiteralExpression): boolean => {
    let migratedAny = false;
    for (const prop of filesObj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const value = prop.initializer;

      // Array sugar (`"x.md": ["", "build"]`) -> `{ commands: [...] }`.
      if (ts.isArrayLiteralExpression(value)) {
        edits.push({
          start: value.getStart(sf),
          end: value.getEnd(),
          replacement: `{ commands: ${value.getText(sf)} }`,
        });
        migratedAny = true;
        continue;
      }

      if (!ts.isObjectLiteralExpression(value)) continue;
      const { properties } = extractProperties(value, sf);
      const hasRemoved = properties.some((p) =>
        (REMOVED_FILECONFIG_KEYS as readonly string[]).includes(p.name),
      );
      const isFileConfigShape = properties.some(
        (p) => p.name === "commands" || p.name === "layout" || p.name === "noExpand",
      );

      if (hasRemoved) {
        const entryIndent = indentOf(original, value.getStart(sf)).length;
        const migrated = migrateFileConfig(value, sf, entryIndent);
        edits.push({
          start: value.getStart(sf),
          end: value.getEnd(),
          replacement: migrated.text,
        });
        migratedAny = true;
        if (migrated.layoutReview) {
          addTodo("layout-review", migrated.layoutReview, value.getStart(sf));
        }
        if (migrated.variableRef) {
          addTodo("variable-ref", migrated.variableRef, value.getStart(sf));
        }
      } else if (!isFileConfigShape) {
        // Bare CommandMap (`"x.md": { "": true, build: (md) => ... }`) ->
        // `{ commands: { ... } }`.
        edits.push({
          start: value.getStart(sf),
          end: value.getEnd(),
          replacement: `{ commands: ${value.getText(sf)} }`,
        });
        migratedAny = true;
      }
      // else: already a FileConfig with no removed keys -> leave as-is.
    }
    return migratedAny;
  };

  for (const replacement of replacements) {
    const { call } = replacement;

    // Non-literal config (variable ref). Try to resolve a same-file
    // `const <name> = { ... }` and migrate the FileConfig entries inside its
    // `files` property. If we cannot resolve it (or its `files` is itself a
    // non-literal), leave a variable-ref TODO instead of silently skipping.
    if (!call.isObjectLiteral) {
      if (ts.isIdentifier(call.argNode)) {
        const resolved = resolveConstObjectLiteral(sf, call.argNode.text);
        const filesEntry = resolved?.properties.find(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) &&
            (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) &&
            p.name.text === "files",
        );
        let filesObjNode: ts.ObjectLiteralExpression | undefined;
        if (filesEntry) {
          if (ts.isObjectLiteralExpression(filesEntry.initializer)) {
            filesObjNode = filesEntry.initializer;
          } else if (ts.isIdentifier(filesEntry.initializer)) {
            // `files: someFilesConst` inside the resolved config object.
            filesObjNode = resolveConstObjectLiteral(sf, filesEntry.initializer.text);
          }
        }
        if (filesObjNode && migrateFilesObject(filesObjNode)) {
          // Migrated the referenced const's `files` in place. The object-literal
          // branch below (which deletes removed top-level config keys and applies
          // the planned rootDoc rewrite) targets the call-site literal and is
          // skipped here, so flag anything it would have handled in the resolved
          // const rather than silently leaving it.
          for (const key of REMOVED_CONFIG_KEYS) {
            const hasKey = resolved?.properties.some(
              (p) =>
                ts.isPropertyAssignment(p) &&
                (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) &&
                p.name.text === key,
            );
            if (hasKey) {
              addTodo(
                "layout-review",
                `\`${key}\` in the referenced config \`${call.argNode.text}\` must be folded into \`rootDoc.layout\` (not auto-removed for variable-referenced configs)`,
                call.argStart,
              );
            }
          }
          if (replacement.rootDocValue !== undefined) {
            addTodo(
              "variable-ref",
              `apply the planned \`rootDoc.layout\` rewrite to the referenced config \`${call.argNode.text}\``,
              call.argStart,
            );
          }
          continue;
        }
      }
      addTodo(
        "variable-ref",
        "config is not an inline object literal; apply the files/rootDoc rewrite to the referenced definition",
        call.argStart,
      );
      continue;
    }

    // Spread of a shared base.
    for (const spread of call.spreads) {
      addTodo(
        "spread-config",
        `spread of \`${spread}\` may carry removed keys (rootInfo / FileConfig.title|description|render); migrate the base separately`,
        call.argStart,
      );
    }

    // Removed top-level config keys (rootInfo): fold into layout, delete key.
    for (const key of REMOVED_CONFIG_KEYS) {
      const removedProp = getProperty(call, key);
      if (!removedProp) continue;
      // Delete the whole `<key>: {...},` property text.
      const span = propertyDeletionSpan(original, call, key);
      if (span) {
        edits.push({ start: span.start, end: span.end, replacement: "" });
      }
      addTodo(
        "layout-review",
        `\`${key}\` (title/description/header/footer) was removed; fold it into \`rootDoc.layout\``,
        call.argStart,
      );
    }

    // Dynamic keys in `files` / `path`.
    const filesProp = getProperty(call, "files");
    if (filesProp && hasComputedKeys(filesProp.valueText)) {
      addTodo(
        "dynamic-key",
        "`files` uses a computed key; rewrite the value to a static path or migrate manually",
        filesProp.node.getStart(sf),
      );
    }

    // Removed FileConfig keys (title/description/render) inside a `files`
    // entry. We statically migrate them into a NEW FileConfig with a `layout`.
    // This applies whether `files` is an INLINE object literal at the call
    // site or an IDENTIFIER referencing a same-file `const files = { ... }`.
    //
    // When a per-command override CommandMap was planned (replacement.filesValue
    // — the prose-carrying doc case), that wholesale replacement wins and we do
    // NOT also splice individual entries (the two edits would overlap).
    if (filesProp && replacement.filesValue === undefined) {
      let filesObjNode: ts.ObjectLiteralExpression | undefined;
      if (ts.isObjectLiteralExpression(filesProp.node)) {
        filesObjNode = filesProp.node;
      } else if (ts.isIdentifier(filesProp.node)) {
        filesObjNode = resolveConstObjectLiteral(sf, filesProp.node.text);
        if (!filesObjNode) {
          // `files` is a bare identifier we could not resolve to a literal.
          addTodo(
            "variable-ref",
            `\`files\` references \`${filesProp.node.text}\` which is not a same-file object literal; migrate that definition's FileConfig entries (title/description -> layout, drop render)`,
            filesProp.node.getStart(sf),
          );
        }
      }
      if (filesObjNode) {
        migrateFilesObject(filesObjNode);
      }
    }

    // Apply planned value replacements.
    if (replacement.filesValue !== undefined && filesProp) {
      edits.push({
        start: filesProp.node.getStart(sf),
        end: filesProp.node.getEnd(),
        replacement: replacement.filesValue,
      });
    }
    const rootDocProp = getProperty(call, "rootDoc");
    if (replacement.rootDocValue !== undefined && rootDocProp) {
      edits.push({
        start: rootDocProp.node.getStart(sf),
        end: rootDocProp.node.getEnd(),
        replacement: replacement.rootDocValue,
      });
    }
    if (replacement.layoutReview) {
      addTodo("layout-review", replacement.layoutReview, call.argStart);
    }
  }

  // Merge anchor inserts into the edit list as zero-width insertions.
  for (const a of anchorInserts) {
    edits.push({ start: a.pos, end: a.pos, replacement: a.text });
  }

  const text = applyEdits(original, edits);
  const silentMisses = scanSilentMisses(text);
  return { text, todos, silentMisses };
}

/** Removed keys, with the context (FileConfig vs top-level config) they belong to. */
const ALL_REMOVED_KEYS = [...REMOVED_FILECONFIG_KEYS, ...REMOVED_CONFIG_KEYS] as const;

/**
 * NO-SILENT-MISS scan: re-parse the rewritten text and find any object-literal
 * property assignment whose key is a removed key (title/description/render/
 * rootInfo). For each, require a `// TODO(politty-migrate: ...)` anchor within
 * the few lines above; otherwise it is a silent miss (invalid config left
 * behind with no guidance).
 *
 * This is intentionally AST-based (not regex) so it does not false-positive on
 * the words appearing inside generated `layout` markdown strings or comments.
 */
export function scanSilentMisses(text: string): SilentMiss[] {
  const sf = ts.createSourceFile(
    "scan.ts",
    text,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );
  const lines = text.split("\n");
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }
  const lineOf = (pos: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-based
  };

  const hasNearbyTodo = (line1: number): boolean => {
    // Look up to 4 lines above (and the same line) for a TODO anchor.
    for (let l = line1; l >= Math.max(1, line1 - 4); l--) {
      if ((lines[l - 1] ?? "").includes("TODO(politty-migrate:")) return true;
    }
    return false;
  };

  // Does `parent` (a property's enclosing object literal) also define `name`?
  // Used to scope FileConfig keys to plausible FileConfig objects.
  const objectHasSiblingKey = (parent: ts.Node, name: string): boolean => {
    if (!ts.isObjectLiteralExpression(parent)) return false;
    return parent.properties.some(
      (p) =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) &&
        p.name.text === name,
    );
  };

  const misses: SilentMiss[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const key =
        ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)
          ? node.name.text
          : undefined;
      if (key && (ALL_REMOVED_KEYS as readonly string[]).includes(key)) {
        // `title`/`description`/`render` are common keys in unrelated objects
        // (zod schemas, command defs, fixtures), so only treat them as a missed
        // FileConfig key when the enclosing object also has a `commands` sibling
        // (the FileConfig signature). `rootInfo` is rare enough to flag anywhere.
        const isFileConfigKey = (REMOVED_FILECONFIG_KEYS as readonly string[]).includes(key);
        const inFileConfig = !isFileConfigKey || objectHasSiblingKey(node.parent, "commands");
        if (inFileConfig) {
          const line = lineOf(node.name.getStart(sf));
          if (!hasNearbyTodo(line)) {
            misses.push({ key, line, lineText: (lines[line - 1] ?? "").trim() });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return misses;
}

/** Heuristic: does a `files` object-literal text contain `[expr]:` keys? */
function hasComputedKeys(valueText: string): boolean {
  // A computed key starts a property: `[ ... ]:`. String-literal keys with
  // brackets are not properties, so requiring the trailing `:` is enough.
  return /\[[^\]]+\]\s*:/.test(valueText);
}

/**
 * Compute the source span to delete a named property of the config literal,
 * including its trailing comma and surrounding whitespace/newline.
 */
function propertyDeletionSpan(
  text: string,
  call: ParsedConfigCall,
  key: string,
): { start: number; end: number } | undefined {
  const prop = getProperty(call, key);
  if (!prop) return undefined;
  const sf = call.argNode.getSourceFile();
  // The PropertyAssignment node is the parent of the initializer.
  let node: ts.Node | undefined = prop.node.parent;
  while (node && !ts.isPropertyAssignment(node)) {
    node = node.parent;
  }
  if (!node) return undefined;
  let start = node.getStart(sf);
  let end = node.getEnd();
  // Extend to swallow a trailing comma.
  while (end < text.length && /[ \t]/.test(text[end]!)) end++;
  if (text[end] === ",") end++;
  // Swallow the leading indentation + preceding newline so we don't leave a
  // blank line.
  let s = start;
  while (s > 0 && /[ \t]/.test(text[s - 1]!)) s--;
  if (text[s - 1] === "\n") {
    start = s - 1;
  }
  // Trailing newline after the comma.
  while (end < text.length && /[ \t]/.test(text[end]!)) end++;
  return { start, end };
}
