import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "vitest/config";
import {
  clearRecordedCli,
  ensureRecordedCli,
  getRecordedCli,
  isRecordingCli,
} from "../core/recorded-cli.js";
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

  it("skips entries of contentMappers that are not objects", () => {
    const tsconfig = tsconfigWith([
      null,
      1,
      { package: "politty", options: { entry: "./cli.ts" } },
    ]);

    expect(readRecordingEntry(tsconfig)).toBe(join(project, "cli.ts"));
  });

  it("names the tsconfig in the error when the file does not hold an object", () => {
    const tsconfig = write("tsconfig.json", "null");

    expect(() => readRecordingEntry(tsconfig)).toThrow(tsconfig);
  });

  it("names the tsconfig in the error when it is not valid JSON", () => {
    const tsconfig = write("tsconfig.json", "{ not json");

    expect(() => readRecordingEntry(tsconfig)).toThrow(tsconfig);
  });

  it("reads a tsconfig that starts with a byte order mark", () => {
    const tsconfig = write(
      "tsconfig.json",
      `\uFEFF${JSON.stringify({ contentMappers: [{ package: "politty", options: { entry: "./cli.ts" } }] })}`,
    );

    expect(readRecordingEntry(tsconfig)).toBe(join(project, "cli.ts"));
  });

  it("throws an error that names both entries when politty content mappers declare different ones", () => {
    const tsconfig = tsconfigWith([
      { package: "politty", options: { entry: "./a.ts" } },
      { package: "@politty/zod", options: { entry: "./b.ts" } },
    ]);

    expect(() => readRecordingEntry(tsconfig)).toThrow(
      new RegExp(`${join(project, "a.ts")}.*${join(project, "b.ts")}`, "s"),
    );
  });

  it("accepts several politty content mappers that declare the same entry", () => {
    const tsconfig = tsconfigWith([
      { package: "politty", options: { entry: "./cli.ts" } },
      { package: "@politty/zod", options: { entry: "cli.ts" } },
    ]);

    expect(readRecordingEntry(tsconfig)).toBe(join(project, "cli.ts"));
  });

  it("explains the content mapper entry option when no mapper declares one", () => {
    const tsconfig = tsconfigWith([{ package: "politty" }]);

    expect(() => readRecordingEntry(tsconfig)).toThrow(/contentMappers.*entry/s);
  });
});

describe("recording setup module", () => {
  const entryCalling = (body: string): string =>
    write(
      "entry.mjs",
      `import { runMain } from ${JSON.stringify(pathToFileURL(runnerPath).href)};\n${body}\n`,
    );

  const runSetup = async (entry: string, graceMs?: number): Promise<void> => {
    await registerSetup(entry, graceMs);
    await ensureRecordedCli();
  };

  const registerSetup = async (entry: string, graceMs?: number): Promise<void> => {
    const file = writeRecordingSetup(entry, graceMs);
    await import(/* @vite-ignore */ `${pathToFileURL(file).href}?run=${Math.random()}`);
  };

  it("does not load the entry until the CLI is first needed", async () => {
    const entry = entryCalling(
      'globalThis.__politty_entry_loaded = true;\nrunMain({ name: "cli" });',
    );

    await registerSetup(entry);
    const loadedBefore = (globalThis as Record<string, unknown>)["__politty_entry_loaded"];
    await ensureRecordedCli();

    expect(loadedBefore).toBeUndefined();
    expect((globalThis as Record<string, unknown>)["__politty_entry_loaded"]).toBe(true);
    delete (globalThis as Record<string, unknown>)["__politty_entry_loaded"];
  });

  it("records the command and options that the entry passes to runMain", async () => {
    const entry = entryCalling('runMain({ name: "cli" }, { version: "1.2.3" });');

    await runSetup(entry);

    expect(getRecordedCli()).toEqual({ command: { name: "cli" }, options: { version: "1.2.3" } });
  });

  it("waits for a runMain call that the entry makes after its module has been evaluated", async () => {
    const entry = entryCalling('setTimeout(() => runMain({ name: "late" }), 20);');

    await runSetup(entry, 100);

    expect(getRecordedCli()?.command).toEqual({ name: "late" });
  });

  it("finishes when the entry calls runCommand before runMain", async () => {
    const runnerUrl = JSON.stringify(pathToFileURL(runnerPath).href);
    const entry = write(
      "entry-with-run-command.mjs",
      `import { runCommand, runMain } from ${runnerUrl};
await runCommand({ name: "x", run() {} }, []);
runMain({ name: "cli" });
`,
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      runSetup(entry),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("setup deadlocked")), 3000);
      }),
    ]).finally(() => clearTimeout(timer));

    expect(getRecordedCli()?.command).toEqual({ name: "cli" });
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

  it("keeps the recorded CLI when the entry module is already loaded", async () => {
    const entry = entryCalling('runMain({ name: "cli" });');
    await runSetup(entry);

    await runSetup(entry);

    expect(getRecordedCli()?.command).toEqual({ name: "cli" });
  });

  it("finishes without loading again an entry that awaits runMain and is already recorded", async () => {
    const entry = entryCalling('await runMain({ name: "cli" });');
    await runSetup(entry);

    await runSetup(entry);

    expect(getRecordedCli()?.command).toEqual({ name: "cli" });
  });

  it("does not keep the CLI of another entry when the new entry fails before runMain", async () => {
    await runSetup(entryCalling('runMain({ name: "first" });'));
    const second = write("second.mjs", 'throw new Error("second exploded");');

    await expect(runSetup(second)).rejects.toThrow("second exploded");

    expect(getRecordedCli()).toBeUndefined();
  });

  it("stops recording once the entry has loaded", async () => {
    await runSetup(entryCalling('runMain({ name: "cli" });'));

    expect(isRecordingCli()).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "writes the setup file into a directory that only the current user can use",
    () => {
      const file = writeRecordingSetup("/tmp/cli.ts");

      expect(statSync(dirname(file)).mode & 0o077).toBe(0);
      expect(statSync(file).mode & 0o077).toBe(0);
    },
  );

  it("writes each setup file into a new directory", () => {
    expect(dirname(writeRecordingSetup("/tmp/cli.ts"))).not.toBe(
      dirname(writeRecordingSetup("/tmp/cli.ts")),
    );
  });

  it("embeds the entry URL as a string literal", () => {
    const source = renderRecordingSetup('file:///tmp/with "quotes"/cli.ts', 100);

    expect(source).toContain(JSON.stringify('file:///tmp/with "quotes"/cli.ts'));
  });

  it("imports the entry through a file URL so that no path character changes its meaning", () => {
    const source = readFileSync(writeRecordingSetup("/tmp/dir #1?/cli.ts"), "utf8");

    expect(source).toContain(JSON.stringify(pathToFileURL("/tmp/dir #1?/cli.ts").href));
  });
});

describe("politty vite plugin", () => {
  const setupFilesOf = (
    plugin: ReturnType<typeof politty>,
    userConfig: { root?: string; test?: { root?: string; setupFiles?: string[] } },
  ): string[] | undefined => plugin.config(userConfig, { mode: "test" })?.test.setupFiles;

  it("is named politty", () => {
    expect(politty().name).toBe("politty");
  });

  it("adds a setup file that loads the entry of ./tsconfig.json under the root", () => {
    tsconfigWith([{ package: "politty", options: { entry: "./src/cli.ts" } }]);

    const [setupFile] = setupFilesOf(politty(), { root: project }) ?? [];

    expect(readFileSync(setupFile!, "utf8")).toContain(
      JSON.stringify(pathToFileURL(join(project, "src/cli.ts")).href),
    );
  });

  it("reads the tsconfig given by the tsconfig option, relative to the root", () => {
    write(
      "config/tsconfig.test.json",
      JSON.stringify({ contentMappers: [{ package: "politty", options: { entry: "../cli.ts" } }] }),
    );

    const [setupFile] =
      setupFilesOf(politty({ tsconfig: "config/tsconfig.test.json" }), { root: project }) ?? [];

    expect(readFileSync(setupFile!, "utf8")).toContain(
      JSON.stringify(pathToFileURL(join(project, "cli.ts")).href),
    );
  });

  it("loads the entry given by the entry option, relative to the root, without reading a tsconfig", () => {
    const [setupFile] = setupFilesOf(politty({ entry: "./src/cli.ts" }), { root: project }) ?? [];

    expect(readFileSync(setupFile!, "utf8")).toContain(
      JSON.stringify(pathToFileURL(join(project, "src/cli.ts")).href),
    );
  });

  it("prefers the entry option over the entry of the tsconfig", () => {
    tsconfigWith([{ package: "politty", options: { entry: "./from-tsconfig.ts" } }]);

    const [setupFile] =
      setupFilesOf(politty({ entry: "./from-option.ts" }), { root: project }) ?? [];

    expect(readFileSync(setupFile!, "utf8")).toContain(
      JSON.stringify(pathToFileURL(join(project, "from-option.ts")).href),
    );
  });

  it("resolves the entry against the root that vitest --root puts in test.root", () => {
    const [setupFile] =
      setupFilesOf(politty({ entry: "./src/cli.ts" }), { test: { root: project } }) ?? [];

    expect(readFileSync(setupFile!, "utf8")).toContain(
      JSON.stringify(pathToFileURL(join(project, "src/cli.ts")).href),
    );
  });

  describe("when politty() is registered twice in one project", () => {
    const configOf = (setupFiles: string[]): { root: string; test: { setupFiles: string[] } } => ({
      root: project,
      test: { setupFiles },
    });

    it("throws an error that names both entries", () => {
      const first = setupFilesOf(politty({ entry: "./a.ts" }), { root: project }) ?? [];

      expect(() => setupFilesOf(politty({ entry: "./b.ts" }), configOf(first))).toThrow(
        new RegExp(`${join(project, "a.ts")}.*${join(project, "b.ts")}`, "s"),
      );
    });

    it("tells to give each entry its own item in test.projects", () => {
      const first = setupFilesOf(politty({ entry: "./a.ts" }), { root: project }) ?? [];

      expect(() => setupFilesOf(politty({ entry: "./b.ts" }), configOf(first))).toThrow(
        /test\.projects/,
      );
    });

    it("adds no second setup file when both register the same entry", () => {
      const first = setupFilesOf(politty({ entry: "./a.ts" }), { root: project }) ?? [];

      expect(setupFilesOf(politty({ entry: "./a.ts" }), configOf(first))).toBeUndefined();
    });

    it("tells to remove the plugin from the root config or set extends: false", () => {
      const first = setupFilesOf(politty({ entry: "./a.ts" }), { root: project }) ?? [];

      expect(() => setupFilesOf(politty({ entry: "./b.ts" }), configOf(first))).toThrow(
        /extends: false/,
      );
    });

    it("accepts an entry in another project whose config does not hold the first setup file", () => {
      setupFilesOf(politty({ entry: "./a.ts" }), { root: project });

      expect(setupFilesOf(politty({ entry: "./b.ts" }), { root: project })).toHaveLength(1);
    });

    it("accepts a project that already lists setup files of its own", () => {
      expect(setupFilesOf(politty({ entry: "./a.ts" }), configOf(["./own-setup.ts"]))).toHaveLength(
        1,
      );
    });
  });

  it("does nothing outside a Vitest run, even in test mode", () => {
    vi.stubEnv("VITEST", "");

    expect(politty().config({ root: project }, { mode: "production" })).toBeUndefined();
    expect(politty().config({ root: project }, { mode: "test" })).toBeUndefined();
  });

  it("is accepted as a plugin by the vitest config", () => {
    expect(defineConfig({ plugins: [politty()] })).toBeDefined();
  });
});
