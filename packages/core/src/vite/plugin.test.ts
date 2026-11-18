import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "vitest/config";
import { clearRecordedCli, getRecordedCli, isRecordingCli } from "../core/recorded-cli.js";
import { politty, readRecordingEntry, renderRecordingSetup, writeRecordingSetup } from "./index.js";

const runnerPath = fileURLToPath(new URL("../core/runner.ts", import.meta.url));

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "politty-vite-test-"));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  clearRecordedCli();
  vi.unstubAllEnvs();
});

const write = (relative: string, content: string): string => {
  const file = join(project, relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
};

const tsconfigWith = (contentMappers: unknown): string =>
  write("tsconfig.json", JSON.stringify({ contentMappers }));

describe("readRecordingEntry", () => {
  it("resolves the entry of a politty content mapper relative to the tsconfig", () => {
    const tsconfig = tsconfigWith([{ package: "politty", options: { entry: "./src/cli.ts" } }]);

    expect(readRecordingEntry(tsconfig)).toBe(join(project, "src/cli.ts"));
  });

  it.each(["@politty/zod", "@politty/valibot", "@politty/zod-mini"])(
    "accepts the %s content mapper",
    (name) => {
      const tsconfig = tsconfigWith([{ package: name, options: { entry: "./cli.ts" } }]);

      expect(readRecordingEntry(tsconfig)).toBe(join(project, "cli.ts"));
    },
  );

  it("ignores content mappers of other packages", () => {
    const tsconfig = tsconfigWith([
      { package: "motherload", extensions: [".toml"], options: { entry: "./other.ts" } },
      { package: "politty", options: { entry: "./cli.ts" } },
    ]);

    expect(readRecordingEntry(tsconfig)).toBe(join(project, "cli.ts"));
  });

  it("reads a tsconfig that has comments and trailing commas", () => {
    const tsconfig = write(
      "tsconfig.json",
      `{
        // the mapper that types the global options
        "contentMappers": [
          { "package": "politty", "options": { "entry": "./cli.ts", }, },
        ],
      }`,
    );

    expect(readRecordingEntry(tsconfig)).toBe(join(project, "cli.ts"));
  });

  it("names the tsconfig in the error when it cannot be read", () => {
    const missing = join(project, "missing.json");

    expect(() => readRecordingEntry(missing)).toThrow(missing);
  });

  it("explains the content mapper entry option when no mapper declares one", () => {
    const tsconfig = tsconfigWith([{ package: "politty" }]);

    expect(() => readRecordingEntry(tsconfig)).toThrow(/contentMappers.*entry/s);
  });
});

describe("recording setup module", () => {
  const entryCalling = (body: string): string =>
    write("entry.mjs", `import { runMain } from ${JSON.stringify(runnerPath)};\n${body}\n`);

  const runSetup = async (entry: string): Promise<void> => {
    const file = writeRecordingSetup(entry);
    await import(/* @vite-ignore */ `${file}?run=${Math.random()}`);
  };

  it("records the command and options that the entry passes to runMain", async () => {
    const entry = entryCalling('runMain({ name: "cli" }, { version: "1.2.3" });');

    await runSetup(entry);

    expect(getRecordedCli()).toEqual({ command: { name: "cli" }, options: { version: "1.2.3" } });
  });

  it("finishes when the entry awaits runMain at the top level", async () => {
    const entry = entryCalling('await runMain({ name: "cli" });');

    await runSetup(entry);

    expect(getRecordedCli()?.command).toEqual({ name: "cli" });
  });

  it("finishes without a recorded CLI when the entry never calls runMain", async () => {
    const entry = entryCalling("export const noop = 1;");

    await runSetup(entry);

    expect(getRecordedCli()).toBeUndefined();
  });

  it("rejects with the error of an entry that fails before it calls runMain", async () => {
    const entry = entryCalling('throw new Error("entry exploded");');

    await expect(runSetup(entry)).rejects.toThrow("entry exploded");
  });

  it("ignores an error that the entry throws after it called runMain", async () => {
    const entry = entryCalling(
      'runMain({ name: "cli" });\nawait Promise.resolve();\nthrow new Error("late");',
    );

    await runSetup(entry);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(getRecordedCli()?.command).toEqual({ name: "cli" });
  });

  it("drops a CLI recorded by an earlier run", async () => {
    await runSetup(entryCalling('runMain({ name: "first" });'));

    await runSetup(entryCalling("export const noop = 1;"));

    expect(getRecordedCli()).toBeUndefined();
  });

  it("stops recording once the entry has loaded", async () => {
    await runSetup(entryCalling('runMain({ name: "cli" });'));

    expect(isRecordingCli()).toBe(false);
  });

  it("embeds the entry path as a string literal", () => {
    const source = renderRecordingSetup('/tmp/with "quotes"/cli.ts');

    expect(source).toContain(JSON.stringify('/tmp/with "quotes"/cli.ts'));
  });
});

describe("politty vite plugin", () => {
  const setupFilesOf = (
    plugin: ReturnType<typeof politty>,
    userConfig: { root?: string },
  ): string[] | undefined => plugin.config(userConfig, { mode: "test" })?.test.setupFiles;

  it("is named politty", () => {
    expect(politty().name).toBe("politty");
  });

  it("adds a setup file that loads the entry of ./tsconfig.json under the root", () => {
    tsconfigWith([{ package: "politty", options: { entry: "./src/cli.ts" } }]);

    const [setupFile] = setupFilesOf(politty(), { root: project }) ?? [];

    expect(readFileSync(setupFile!, "utf8")).toContain(JSON.stringify(join(project, "src/cli.ts")));
  });

  it("reads the tsconfig given by the tsconfig option, relative to the root", () => {
    write(
      "config/tsconfig.test.json",
      JSON.stringify({ contentMappers: [{ package: "politty", options: { entry: "../cli.ts" } }] }),
    );

    const [setupFile] =
      setupFilesOf(politty({ tsconfig: "config/tsconfig.test.json" }), { root: project }) ?? [];

    expect(readFileSync(setupFile!, "utf8")).toContain(JSON.stringify(join(project, "cli.ts")));
  });

  it("does nothing outside a test run", () => {
    vi.stubEnv("VITEST", "");

    expect(politty().config({ root: project }, { mode: "production" })).toBeUndefined();
  });

  it("is accepted as a plugin by the vitest config", () => {
    expect(defineConfig({ plugins: [politty()] })).toBeDefined();
  });
});
