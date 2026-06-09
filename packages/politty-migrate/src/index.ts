/**
 * Orchestration for `politty migrate`.
 *
 * Pipeline (Phase 4 of the redesign plan):
 *   1. scan the target for files containing `assertDocMatch` / `generateDoc`;
 *   2. parse each call's config (parse-config);
 *   3. for each referenced OLD golden `.md`, parse it (parse-doc) and generate
 *      NEW config fragments + a transformed `.md` plan (gen-config);
 *   4. rewrite the config TS, leaving TODO anchors where it must (rewrite);
 *   5. verify each transformed `.md` is marker-only-different from the OLD one
 *      (verify);
 *   6. write `politty-migrate.todo.md` with the fixed AI playbook (playbook).
 *
 * The orchestrator is filesystem-driven and returns a structured report so the
 * CLI can print a summary and so `--dry-run` can show planned changes without
 * writing.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { buildLayoutFromDoc, generateCommandConfigs, renderCommandMap } from "./gen-config.js";
import { getProperty, parseConfigSource, type ParsedConfigCall } from "./parse-config.js";
import { parseOldDoc, type ParsedOldDoc } from "./parse-doc.js";
import type { PlaybookTodoEntry } from "./playbook.js";
import { renderPlaybook } from "./playbook.js";
import {
  REMOVED_FILECONFIG_KEYS,
  rewriteSource,
  type ConfigReplacement,
  type RewriteTodo,
  type SilentMiss,
} from "./rewrite.js";

export interface MigrateOptions {
  /** Root directory to scan / operate within. */
  cwd: string;
  /** Optional explicit list of TS files; when absent, the repo is scanned. */
  files?: string[];
  /** When true, do not write any files. */
  dryRun: boolean;
}

export interface FileReport {
  /** TS file path (absolute). */
  configFile: string;
  /** Number of doc-generation calls found. */
  calls: number;
  /** TODO anchors left in this file. */
  todos: RewriteTodo[];
  /** Whether the file text changed. */
  changed: boolean;
  /**
   * NO-SILENT-MISS findings: leftover removed keys with no nearby TODO. MUST be
   * empty; a non-empty list means invalid config was left silently.
   */
  silentMisses: SilentMiss[];
}

export interface MigrateReport {
  files: FileReport[];
  todos: PlaybookTodoEntry[];
  /** Path the playbook was (or would be) written to. */
  playbookPath: string;
  dryRun: boolean;
}

const DOC_CALL_RE = /\b(?:assertDocMatch|generateDoc)\s*\(/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".turbo"]);

/** Recursively find candidate `.ts` files that mention a doc-generation call. */
export function findConfigFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile() && /\.(?:ts|mts|cts)$/.test(entry.name)) {
        let text: string;
        try {
          text = fs.readFileSync(full, "utf-8");
        } catch {
          continue;
        }
        if (DOC_CALL_RE.test(text)) out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

/** Convert a char offset to a 1-based line number. */
function lineAt(text: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/**
 * Find the nearest ancestor directory containing a package.json, starting from
 * `dir`. Returns `undefined` if none is found up to the filesystem root.
 */
function findPackageRoot(dir: string): string | undefined {
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, "package.json"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
}

/**
 * Base directories (in priority order) against which a config's relative `.md`
 * paths are resolved. Doc paths in `assertDocMatch` are relative to the cwd the
 * doc test runs in — typically the config file's package root — so we try the
 * package root and the config dir before the process cwd. This makes migration
 * work regardless of where the CLI is invoked from (e.g. `--file` from another
 * directory).
 */
export function docBaseDirs(configFile: string, cwd: string): string[] {
  const dirs: string[] = [];
  const pkgRoot = findPackageRoot(path.dirname(configFile));
  if (pkgRoot) dirs.push(pkgRoot);
  dirs.push(path.dirname(configFile));
  dirs.push(cwd);
  return [...new Set(dirs)];
}

/**
 * Resolve `.md` paths referenced by a call (in `files` / `path` / `rootDoc`),
 * trying each base directory in order, returning the ones that exist on disk.
 */
export function resolveReferencedDocs(call: ParsedConfigCall, baseDirs: string[]): string[] {
  const filesProp = call.properties.find((p) => p.name === "files");
  const pathProp = call.properties.find((p) => p.name === "path");
  const rootDocProp = call.properties.find((p) => p.name === "rootDoc");
  const docs = new Set<string>();
  const addFromText = (text: string): void => {
    // Pull string literals that look like paths to `.md` files.
    const re = /["'`]([^"'`]+\.md)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      docs.add(m[1]!);
    }
  };
  if (filesProp) addFromText(filesProp.valueText);
  if (pathProp) addFromText(pathProp.valueText);
  if (rootDocProp) addFromText(rootDocProp.valueText);

  const resolved: string[] = [];
  for (const p of docs) {
    if (path.isAbsolute(p)) {
      if (fs.existsSync(p)) resolved.push(p);
      continue;
    }
    for (const base of baseDirs) {
      const full = path.join(base, p);
      if (fs.existsSync(full)) {
        resolved.push(full);
        break;
      }
    }
  }
  return resolved;
}

/**
 * Run the migration over the configured files.
 */
export function migrate(options: MigrateOptions): MigrateReport {
  const { cwd, dryRun } = options;
  const configFiles = options.files ?? findConfigFiles(cwd);

  const fileReports: FileReport[] = [];
  const playbookEntries: PlaybookTodoEntry[] = [];

  for (const configFile of configFiles) {
    const sourceText = fs.readFileSync(configFile, "utf-8");
    const parsed = parseConfigSource(configFile, sourceText);
    if (parsed.calls.length === 0) continue;

    // Build replacements per call. We rewrite `files` to a CommandMap when the
    // referenced doc carries per-command customization; otherwise we leave the
    // (still-valid) array form alone and rely on `POLITTY_DOCS_UPDATE` to
    // regenerate markers.
    const replacements: ConfigReplacement[] = [];
    const baseDirs = docBaseDirs(configFile, cwd);
    for (const call of parsed.calls) {
      const referenced = resolveReferencedDocs(call, baseDirs);
      const docs: ParsedOldDoc[] = referenced.map((p) => parseOldDoc(fs.readFileSync(p, "utf-8")));
      const replacement: ConfigReplacement = { call };

      const oldDocs = docs.filter((d) => d.isOldFormat);

      // A `files` entry that carries removed FileConfig keys (render / title /
      // description) MUST be converted regardless of prose: the NEW FileConfig
      // type rejects those keys, so leaving the value untouched would produce
      // an illegal config. Treat that as a customization signal too.
      const filesProp = getProperty(call, "files");
      const filesHasRemovedKeys =
        filesProp !== undefined &&
        REMOVED_FILECONFIG_KEYS.some((k) => new RegExp(`\\b${k}\\s*:`).test(filesProp.valueText));

      // A layout is needed when there is any file-level content the NEW
      // markerless layout must reconstruct: global-options, index, root
      // header/footer, OR any leftover free text outside command markers
      // (which would otherwise be silently dropped).
      const needsLayout = oldDocs.some(
        (d) =>
          d.freeText.length > 0 ||
          d.file.globalOptions !== undefined ||
          d.file.index !== undefined ||
          d.file.rootHeader !== undefined ||
          d.file.rootFooter !== undefined,
      );

      // A doc needs a CommandMap when any of its commands is non-default
      // (carries inter-section prose, reordering, etc.), OR when the `files`
      // entry used removed FileConfig keys (render/title/description).
      const customDoc =
        oldDocs.find((d) => generateCommandConfigs(d).some((c) => !c.isDefault)) ??
        (filesHasRemovedKeys ? oldDocs[0] : undefined);
      if (customDoc) {
        const map = renderCommandMap(generateCommandConfigs(customDoc));
        replacement.filesValue = wrapSingleFileMap(call, map);
        replacement.layoutReview =
          "verify the generated per-command override templates (free-text placement / section order)";
      }

      // When a rootDoc is present and the file carries layout content, generate
      // a concrete `rootDoc.layout` embedding the root header/footer free text
      // plus md.globalOptions / md.index / md.commands().
      const rootDocProp = getProperty(call, "rootDoc");
      const layoutDoc = oldDocs.find(
        (d) =>
          d.file.globalOptions !== undefined ||
          d.file.index !== undefined ||
          d.file.rootHeader !== undefined ||
          d.file.rootFooter !== undefined,
      );
      if (rootDocProp && layoutDoc) {
        const layout = buildLayoutFromDoc(layoutDoc);
        replacement.rootDocValue = mergeRootDocLayout(rootDocProp.valueText, layout);
      }

      if (needsLayout) {
        replacement.layoutReview =
          "file-level free text / global-options / index detected; verify the generated `rootDoc.layout` (md.globalOptions / md.index / md.commands()) preserves the original prose";
      }
      replacements.push(replacement);
    }

    const { text, todos, silentMisses } = rewriteSource(parsed, replacements);
    const changed = text !== sourceText;
    if (changed && !dryRun) {
      fs.writeFileSync(configFile, text, "utf-8");
    }
    fileReports.push({
      configFile,
      calls: parsed.calls.length,
      todos,
      changed,
      silentMisses,
    });
    for (const t of todos) {
      playbookEntries.push({
        category: t.category,
        file: path.relative(cwd, configFile) || configFile,
        detail: t.detail,
        line: lineAt(sourceText, t.position),
      });
    }
  }

  const playbookPath = path.join(cwd, "politty-migrate.todo.md");
  // Only write the playbook when something was actually processed — a no-op
  // run ("No assertDocMatch/generateDoc calls found") must not create files.
  if (!dryRun && fileReports.length > 0) {
    fs.writeFileSync(playbookPath, renderPlaybook(playbookEntries), "utf-8");
  }

  return { files: fileReports, todos: playbookEntries, playbookPath, dryRun };
}

/**
 * Wrap a generated CommandMap back into the `files` map, preserving the single
 * file key when there is exactly one. When the original `files` had multiple
 * keys we cannot statically reassign, so we return a best-effort single-key map
 * (the layout-review TODO covers the rest).
 */
/**
 * Insert a generated `layout` property into the existing `rootDoc` object
 * literal text, preserving the original `path` / `globalOptions` keys. The
 * layout multiline arrow is re-indented one level to sit inside the object.
 */
function mergeRootDocLayout(rootDocText: string, layout: string): string {
  const indentedLayout = layout
    .split("\n")
    .map((l, i) => (i === 0 ? l : `  ${l}`))
    .join("\n");
  const trimmed = rootDocText.trimEnd();
  if (trimmed.endsWith("}")) {
    const body = trimmed.slice(0, trimmed.lastIndexOf("}")).trimEnd();
    const sep = body.endsWith(",") || body.endsWith("{") ? "" : ",";
    return `${body}${sep}\n  layout: ${indentedLayout},\n}`;
  }
  // Not an object literal we recognize; leave as-is (a TODO covers review).
  return rootDocText;
}

function wrapSingleFileMap(call: ParsedConfigCall, commandMap: string): string {
  const filesProp = call.properties.find((p) => p.name === "files");
  if (!filesProp) return commandMap;
  // Grab the first string-literal key from the original files value.
  const keyMatch = filesProp.valueText.match(/["'`]([^"'`]+\.md)["'`]/);
  const key = keyMatch ? keyMatch[1]! : "docs/cli.md";
  // Wrap the per-command map under `commands:` so the value is a FileConfig
  // (the only accepted FileMapping value shape).
  const indented = commandMap
    .split("\n")
    .map((l, i) => (i === 0 ? l : `    ${l}`))
    .join("\n");
  return `{\n  ${JSON.stringify(key)}: { commands: ${indented} },\n}`;
}
