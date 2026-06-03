#!/usr/bin/env node
/**
 * `politty-migrate` CLI entry point.
 *
 * Standalone (depends only on `typescript`): one-shot converts a project from
 * the OLD marker-based politty docs system to the NEW markerless `md`-template
 * API. Run via `npx politty-migrate`.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./index.js";

/**
 * Available migrations. There is currently a single one; the positional
 * `migration` argument exists so future codemods can be added without
 * breaking the CLI (`politty-migrate <migration> [dir]`).
 */
const MIGRATIONS: Record<string, string> = {
  "doc-markers": "convert the OLD marker-based docs to the NEW markerless md-template API",
};
const DEFAULT_MIGRATION = "doc-markers";

const HELP = `politty-migrate — codemods for upgrading politty projects

Usage: politty-migrate [migration] [options] [dir]

Migrations:
  doc-markers         Convert the OLD marker-based docs to the NEW markerless
                      md-template API (default)

Arguments:
  dir                 Target directory to scan (default: current directory)

Options:
  --file <FILE>       Explicit config file(s) to migrate (repeatable). Skips the scan.
  --dry-run           Show planned changes without writing any files
  -h, --help          Show this help
`;

interface ParsedArgs {
  help: boolean;
  migration: string;
  dir: string;
  files: string[];
  dryRun: boolean;
  /** Whether an explicit target (a positional dir or a --file) was given. */
  hasTarget: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    help: false,
    migration: DEFAULT_MIGRATION,
    dir: ".",
    files: [],
    dryRun: false,
    hasTarget: false,
  };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") {
      result.help = true;
    } else if (a === "--dry-run") {
      result.dryRun = true;
    } else if (a === "--file") {
      const v = argv[++i];
      if (v) {
        result.files.push(v);
        result.hasTarget = true;
      }
    } else if (a.startsWith("--file=")) {
      result.files.push(a.slice("--file=".length));
      result.hasTarget = true;
    } else if (!a.startsWith("-")) {
      positionals.push(a);
    } else {
      process.stderr.write(`Unknown option: ${a}\n`);
    }
  }
  // A first positional that names a known migration selects it; anything else
  // (e.g. `.`, a path) is the target directory.
  if (positionals[0] !== undefined && MIGRATIONS[positionals[0]] !== undefined) {
    result.migration = positionals.shift()!;
  }
  if (positionals[0] !== undefined) {
    result.dir = positionals[0];
    result.hasTarget = true;
  }
  return result;
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }

  console.log(`Running migration: ${parsed.migration} — ${MIGRATIONS[parsed.migration]}`);

  // Safety: a bare invocation with no explicit target (dir or --file) would
  // otherwise rewrite every matching file under the current directory in
  // place. Force dry-run and tell the user how to actually write.
  let dryRun = parsed.dryRun;
  if (!parsed.hasTarget && !dryRun) {
    dryRun = true;
    process.stderr.write(
      "No target given — running in --dry-run mode. Re-run with an explicit directory " +
        "(e.g. `politty-migrate .`) or `--file <f>` to write changes.\n",
    );
  }

  const cwd = path.resolve(parsed.dir);
  const report = migrate({
    cwd,
    ...(parsed.files.length > 0 ? { files: parsed.files.map((f) => path.resolve(cwd, f)) } : {}),
    dryRun,
  });

  const prefix = report.dryRun ? "[dry-run] " : "";
  if (report.files.length === 0) {
    console.log(`${prefix}No assertDocMatch/generateDoc calls found under ${cwd}.`);
    return;
  }

  let changedCount = 0;
  let silentMissCount = 0;
  for (const file of report.files) {
    const rel = path.relative(cwd, file.configFile) || file.configFile;
    const status = file.changed ? "rewritten" : "no-change";
    console.log(`${prefix}${rel}: ${file.calls} call(s), ${status}, ${file.todos.length} TODO(s)`);
    if (file.changed) changedCount++;

    // NO-SILENT-MISS guard: a leftover removed key (title/description/render/
    // rootInfo) without a nearby TODO means the migration produced INVALID
    // config (or silently dropped a custom renderer). This must never be
    // reported as success — surface every miss and fail the run.
    for (const miss of file.silentMisses) {
      silentMissCount++;
      process.stderr.write(
        `${prefix}ERROR ${rel}:${miss.line}: removed key \`${miss.key}\` left behind with no TODO anchor: ${miss.lineText}\n`,
      );
    }
  }

  console.log(
    `${prefix}${changedCount}/${report.files.length} file(s) changed; ${report.todos.length} follow-up TODO(s).`,
  );
  console.log(`${prefix}Playbook: ${report.playbookPath}`);

  if (silentMissCount > 0) {
    process.stderr.write(
      `${prefix}FAILED: ${silentMissCount} silent miss(es) — invalid config (or a dropped renderer) was left behind. ` +
        `Fix the reported locations (add the migration, or a // TODO(politty-migrate: ...) anchor) and re-run.\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (!report.dryRun) {
    console.log("Next: run your doc tests with POLITTY_DOCS_UPDATE=true to regenerate markers.");
  }
}

/**
 * Only auto-run when invoked as the CLI entry point (`node cli.js`), not when
 * imported (e.g. by tests). Comparing the resolved module path to argv[1]
 * keeps the guard tooling-agnostic.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main();
}
