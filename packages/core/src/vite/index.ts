import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { RECORDED_CLI_KEY } from "../core/recorded-cli.js";
import { parseJsonc } from "./jsonc.js";

const POLITTY_PACKAGE = /^(politty|@politty\/.+)$/;

export interface PolittyVitePluginOptions {
  /** Path to the tsconfig that configures the politty content mapper, relative to the Vite root. */
  tsconfig?: string;
}

export interface PolittyVitePlugin {
  name: string;
  config: (
    userConfig: { root?: string },
    env?: { mode: string },
  ) => { test: { setupFiles: string[] } } | undefined;
}

interface ContentMapperEntry {
  package?: unknown;
  options?: { entry?: unknown };
}

export function readRecordingEntry(tsconfigPath: string): string {
  let config: { contentMappers?: ContentMapperEntry[] };
  try {
    config = parseJsonc(readFileSync(tsconfigPath, "utf8")) as typeof config;
  } catch (error) {
    throw new Error(
      `politty: cannot read the tsconfig at ${tsconfigPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const mappers = config.contentMappers;
  const entry = (mappers ?? [])
    .filter((mapper) => typeof mapper.package === "string" && POLITTY_PACKAGE.test(mapper.package))
    .map((mapper) => mapper.options?.entry)
    .find((value): value is string => typeof value === "string");
  if (entry === undefined) {
    throw new Error(
      `politty: no politty entry in "contentMappers" of ${tsconfigPath}. Add the "entry" option of the politty content mapper, the module that calls runMain.`,
    );
  }
  return resolve(dirname(tsconfigPath), entry);
}

export function renderRecordingSetup(entry: string): string {
  return `const entry = ${JSON.stringify(entry)};
const slot = (globalThis[Symbol.for(${JSON.stringify(RECORDED_CLI_KEY)})] ??= {});
if (!slot.recorded || slot.entry !== entry) {
  if (slot.entry !== entry) delete slot.recorded;
  slot.capturing = true;
  const recorded = new Promise((resolve) => {
    slot.onRecord = resolve;
  });
  const loaded = import(entry).then(
    () => undefined,
    (error) => {
      if (!slot.recorded) throw error;
    },
  );
  try {
    await Promise.race([loaded, recorded]);
  } finally {
    slot.capturing = false;
    delete slot.onRecord;
  }
  if (slot.recorded) slot.entry = entry;
}
`;
}

const setupDirectories = new Set<string>();

function removeSetupDirectories(): void {
  for (const directory of setupDirectories) rmSync(directory, { recursive: true, force: true });
}

export function writeRecordingSetup(entry: string): string {
  const directory = mkdtempSync(join(tmpdir(), "politty-vitest-"));
  if (setupDirectories.size === 0) process.once("exit", removeSetupDirectories);
  setupDirectories.add(directory);
  const file = join(directory, "setup.mjs");
  writeFileSync(file, renderRecordingSetup(entry.split(sep).join("/")), { mode: 0o600 });
  return file;
}

/**
 * Vite plugin for Vitest. It loads the CLI entry before each test file with
 * `runMain` only recording its command and options, so `runCommand` can run a
 * subcommand on its own with the same global args, `setup` and `cleanup` as
 * the real CLI.
 */
export function politty(options: PolittyVitePluginOptions = {}): PolittyVitePlugin {
  return {
    name: "politty",
    config(userConfig, env) {
      if (env?.mode !== "test" && !process.env["VITEST"]) return undefined;
      const root = resolve(userConfig.root ?? process.cwd());
      const entry = readRecordingEntry(resolve(root, options.tsconfig ?? "tsconfig.json"));
      return { test: { setupFiles: [writeRecordingSetup(entry)] } };
    },
  };
}
