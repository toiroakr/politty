import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import nodeModule from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileCacheDir, enableCompileCache } from "./compile-cache.js";

// `module.enableCompileCache` exists on Node >= 22.8.0; on older runtimes
// our wrapper is a documented no-op returning `{ enabled: false }`.
const supportsCompileCache =
  typeof nodeModule.enableCompileCache === "function" && !process.env.NODE_DISABLE_COMPILE_CACHE;

// The fresh-process tests spawn plain `node` against the .ts source, which
// relies on type stripping being enabled by default (Node >= 22.18 / >= 23.6).
const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split(".").map(Number);
const supportsTypeStripping =
  nodeMajor >= 24 || (nodeMajor === 23 && nodeMinor >= 6) || (nodeMajor === 22 && nodeMinor >= 18);
const canRunFreshProcessTests = supportsCompileCache && supportsTypeStripping;

describe("compileCacheDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses XDG_CACHE_HOME when set", () => {
    vi.stubEnv("XDG_CACHE_HOME", "/custom/cache");
    expect(compileCacheDir("mycli")).toBe(join("/custom/cache", "mycli", "node-compile-cache"));
  });

  it("falls back to ~/.cache when XDG_CACHE_HOME is unset", () => {
    vi.stubEnv("XDG_CACHE_HOME", "");
    expect(compileCacheDir("mycli")).toBe(join(homedir(), ".cache", "mycli", "node-compile-cache"));
  });
});

describe("enableCompileCache", () => {
  it("enables the cache when supported and never throws", () => {
    // V8 compile-cache state is process-global and may already be pinned by
    // another test file in this worker, so only assert coarse behavior here;
    // exact directory semantics are covered by the fresh-process test below.
    const result = enableCompileCache({ cacheDir: mkdtempSync(join(tmpdir(), "politty-cc-")) });
    expect(result.enabled).toBe(supportsCompileCache);
    if (supportsCompileCache) {
      expect(typeof result.directory).toBe("string");
    }
  });

  it.skipIf(!canRunFreshProcessTests)(
    "persists compiled modules across runs in a fresh process",
    () => {
      const tmp = mkdtempSync(join(tmpdir(), "politty-compile-cache-"));
      try {
        const xdg = join(tmp, "xdg");
        const moduleUrl = new URL("./compile-cache.ts", import.meta.url).href;
        const lazyPath = join(tmp, "lazy.mjs");
        writeFileSync(lazyPath, "export const value = 42;\n");
        const entryPath = join(tmp, "entry.mjs");
        writeFileSync(
          entryPath,
          [
            `import { enableCompileCache } from ${JSON.stringify(moduleUrl)};`,
            `const result = enableCompileCache("fixture-cli");`,
            `const { value } = await import(${JSON.stringify(pathToFileURL(lazyPath).href)});`,
            `console.log(JSON.stringify({ result, value }));`,
            "",
          ].join("\n"),
        );

        const env: NodeJS.ProcessEnv = { ...process.env, XDG_CACHE_HOME: xdg };
        delete env.NODE_COMPILE_CACHE;
        delete env.NODE_DISABLE_COMPILE_CACHE;
        const run = (): { result: { enabled: boolean; directory?: string }; value: number } =>
          JSON.parse(execFileSync(process.execPath, [entryPath], { env, encoding: "utf8" }));

        const expectedDir = join(xdg, "fixture-cli", "node-compile-cache");
        const first = run();
        expect(first.value).toBe(42);
        expect(first.result.enabled).toBe(true);
        expect(first.result.directory).toBe(expectedDir);

        const second = run();
        expect(second.result.enabled).toBe(true);
        expect(readdirSync(expectedDir).length).toBeGreaterThan(0);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!canRunFreshProcessTests)(
    "lets NODE_COMPILE_CACHE win over the derived directory in a fresh process",
    () => {
      const tmp = mkdtempSync(join(tmpdir(), "politty-compile-cache-env-"));
      try {
        const envDir = join(tmp, "env-cache");
        const moduleUrl = new URL("./compile-cache.ts", import.meta.url).href;
        const entryPath = join(tmp, "entry.mjs");
        writeFileSync(
          entryPath,
          [
            `import { enableCompileCache } from ${JSON.stringify(moduleUrl)};`,
            `console.log(JSON.stringify(enableCompileCache("fixture-cli")));`,
            "",
          ].join("\n"),
        );

        const env: NodeJS.ProcessEnv = {
          ...process.env,
          XDG_CACHE_HOME: join(tmp, "xdg"),
          NODE_COMPILE_CACHE: envDir,
        };
        delete env.NODE_DISABLE_COMPILE_CACHE;
        const result: { enabled: boolean; directory?: string } = JSON.parse(
          execFileSync(process.execPath, [entryPath], { env, encoding: "utf8" }),
        );
        expect(result.enabled).toBe(true);
        // Startup enablement via NODE_COMPILE_CACHE reports the resolved
        // version-scoped subdirectory, so match on the prefix.
        expect(result.directory?.startsWith(envDir)).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );
});
