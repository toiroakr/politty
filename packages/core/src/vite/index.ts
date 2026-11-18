import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  let text: string;
  try {
    text = readFileSync(tsconfigPath, "utf8");
  } catch {
    throw new Error(`politty: cannot read the tsconfig at ${tsconfigPath}`);
  }
  const mappers = (parseJsonc(text) as { contentMappers?: ContentMapperEntry[] }).contentMappers;
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
  return `const slot = (globalThis[Symbol.for(${JSON.stringify(RECORDED_CLI_KEY)})] ??= {});
delete slot.recorded;
slot.capturing = true;
const recorded = new Promise((resolve) => {
  slot.onRecord = resolve;
});
const loaded = import(${JSON.stringify(entry)}).then(
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
`;
}

export function writeRecordingSetup(entry: string): string {
  const portable = entry.split(sep).join("/");
  const directory = join(
    tmpdir(),
    "politty-vitest",
    createHash("sha1").update(portable).digest("hex").slice(0, 12),
  );
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "setup.mjs");
  writeFileSync(file, renderRecordingSetup(portable));
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
