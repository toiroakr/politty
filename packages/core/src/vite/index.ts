import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RECORDED_CLI_KEY } from "../core/recorded-cli.js";
import { parseJsonc } from "./jsonc.js";

const REGISTRATION_GRACE_MS = 1000;
const POLITTY_PACKAGE = /^(politty|@politty\/.+)$/;

export interface PolittyVitePluginOptions {
  /** The module that calls `runMain`, relative to the Vite root. Takes precedence over `tsconfig`. */
  entry?: string;
  /** Path to the tsconfig that configures the politty content mapper, relative to the Vite root. */
  tsconfig?: string;
}

export interface PolittyVitePlugin {
  name: string;
  config: (
    userConfig: { root?: string; test?: { root?: string } },
    env?: { mode: string },
  ) => { test: { setupFiles: string[] } } | undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readRecordingEntry(tsconfigPath: string): string {
  let config: unknown;
  try {
    config = parseJsonc(readFileSync(tsconfigPath, "utf8"));
  } catch (error) {
    throw new Error(
      `politty: cannot read the tsconfig at ${tsconfigPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const mappers =
    isObject(config) && Array.isArray(config.contentMappers) ? config.contentMappers : [];
  const entry = mappers
    .filter(isObject)
    .filter((mapper) => typeof mapper.package === "string" && POLITTY_PACKAGE.test(mapper.package))
    .map((mapper) => (isObject(mapper.options) ? mapper.options.entry : undefined))
    .find((value): value is string => typeof value === "string");
  if (entry === undefined) {
    throw new Error(
      `politty: no politty entry in "contentMappers" of ${tsconfigPath}. Add the "entry" option of the politty content mapper, the module that calls runMain.`,
    );
  }
  return resolve(dirname(tsconfigPath), entry);
}

export function renderRecordingSetup(entryUrl: string, graceMs: number): string {
  return `import { beforeAll } from "vitest";
const entry = ${JSON.stringify(entryUrl)};
const slot = (globalThis[Symbol.for(${JSON.stringify(RECORDED_CLI_KEY)})] ??= {});
if (slot.entry !== entry) {
  delete slot.recorded;
  delete slot.loading;
}
slot.loader = async () => {
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
    if (!slot.recorded) {
      let timer;
      const expired = new Promise((resolve) => {
        timer = setTimeout(resolve, ${graceMs});
      });
      await Promise.race([recorded, expired]);
      clearTimeout(timer);
    }
  } finally {
    slot.capturing = false;
    delete slot.onRecord;
  }
  if (slot.recorded) slot.entry = entry;
};
try {
  beforeAll(async () => {
    await slot.ensure?.().catch(() => {});
  });
} catch {}
`;
}

const setupDirectories = new Set<string>();

function removeSetupDirectories(): void {
  for (const directory of setupDirectories) rmSync(directory, { recursive: true, force: true });
}

export function writeRecordingSetup(entry: string, graceMs = REGISTRATION_GRACE_MS): string {
  const directory = mkdtempSync(join(tmpdir(), "politty-vitest-"));
  if (setupDirectories.size === 0) process.once("exit", removeSetupDirectories);
  setupDirectories.add(directory);
  const file = join(directory, "setup.mjs");
  writeFileSync(file, renderRecordingSetup(pathToFileURL(entry).href, graceMs), { mode: 0o600 });
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
    config(userConfig) {
      if (!process.env["VITEST"]) return undefined;
      const root = resolve(userConfig.test?.root ?? userConfig.root ?? process.cwd());
      const entry =
        options.entry === undefined
          ? readRecordingEntry(resolve(root, options.tsconfig ?? "tsconfig.json"))
          : resolve(root, options.entry);
      return { test: { setupFiles: [writeRecordingSetup(entry)] } };
    },
  };
}
