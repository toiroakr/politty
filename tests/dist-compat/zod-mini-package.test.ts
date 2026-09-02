/**
 * Compatibility tests for the published `@politty/zod-mini` package, run
 * against BUILT output (`packages/zod-mini/dist`), not workspace sources.
 *
 * Unlike `@politty/valibot` (which must never load zod at all), zod/mini
 * legitimately *is* zod — the headline guarantee here is narrower: a
 * zod/mini-based CLI must never load classic zod (`zod/v4/classic`, or the
 * bare `"zod"` entry, which re-exports classic). The built dist is scanned
 * for that, and the runtime paths (entry, subpaths, bin) are exercised
 * end-to-end.
 *
 * The dist is built once for the whole project in `global-setup.ts`.
 */

import { execFileSync, execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const zodMiniPkg = resolve(rootDir, "packages/zod-mini");
const zodMiniDist = resolve(zodMiniPkg, "dist");
const zodMiniBin = resolve(zodMiniPkg, "bin/cli.mjs");

function importDist(file: string): Promise<Record<string, unknown>> {
  return import(pathToFileURL(resolve(zodMiniDist, file)).href);
}

describe("@politty/zod-mini dist never loads classic zod", () => {
  it("does not import the bare zod entry or zod/v4/classic", () => {
    // Recursive: tsdown can emit shared chunks into subdirectories, and a
    // chunk that imports classic zod would defeat this test's whole
    // purpose. The bin launcher ships too (package.json `files`), so it is
    // scanned as well.
    const distFiles = readdirSync(zodMiniDist, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(js|mjs|cjs)$/.test(f))
      .map((f) => resolve(zodMiniDist, f));
    expect(distFiles.length).toBeGreaterThan(0);
    for (const file of [...distFiles, zodMiniBin]) {
      const source = readFileSync(file, "utf8");
      const label = relative(zodMiniPkg, file);
      // Covers static/side-effect/dynamic imports and require, with optional
      // whitespace. Only the bare "zod" specifier and "zod/v4/classic" are
      // forbidden — "zod/mini", "zod/v4/mini", and "zod/v4/core" are exactly
      // what this package is supposed to import.
      expect(source, `${label} must not import the bare "zod" entry`).not.toMatch(
        /(\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(?\s*)["']zod["']/,
      );
      expect(source, `${label} must not import zod/v4/classic`).not.toMatch(
        /(\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(?\s*)["']zod\/v4\/classic(\/[^"']+)?["']/,
      );
    }
  });
});

describe("@politty/zod-mini dist runtime", () => {
  it("runs a zod/mini-schema command end-to-end through the built entry", async () => {
    const { defineCommand, runCommand } = (await importDist("index.js")) as {
      defineCommand: (def: unknown) => unknown;
      runCommand: (
        cmd: unknown,
        argv: string[],
      ) => Promise<{ success: boolean; result?: unknown; error?: Error }>;
    };
    const z = await import("zod/mini");

    const cmd = defineCommand({
      name: "greet",
      args: z.object({ name: z.string(), loud: z._default(z.boolean(), false) }),
      run: (args: { name: string; loud: boolean }) => `hello ${args.name}${args.loud ? "!" : ""}`,
    });

    const ok = await runCommand(cmd, ["--name", "world", "--loud"]);
    expect(ok.success).toBe(true);
    expect(ok.result).toBe("hello world!");

    // Validation errors must keep the zod/mini adapter's rich messages.
    const bad = await runCommand(cmd, ["--name"]);
    expect(bad.success).toBe(false);
    expect(String(bad.error?.message)).toContain("name");
  });

  it("exposes every documented subpath entry from dist", async () => {
    // prompt/clack and prompt/inquirer are omitted: their optional peer
    // deps are intentionally not installed at the workspace root.
    const entries = ["docs.js", "completion.js", "skill.js", "prompt.js", "compile-cache.js"];
    for (const entry of entries) {
      const mod = await importDist(entry);
      expect(Object.keys(mod).length, `${entry} should re-export something`).toBeGreaterThan(0);
    }
  });
});

describe("@politty/zod-mini bin", () => {
  it("politty bin runs from the built package", () => {
    const out = execFileSync(
      process.execPath,
      [resolve(rootDir, "packages/zod-mini/bin/cli.mjs"), "--help"],
      { encoding: "utf8" },
    );
    expect(out).toContain("politty");
    expect(out).toContain("Usage:");
  });
});

describe('declare module "@politty/zod-mini" GlobalArgs augmentation', () => {
  function tsgo(fixture: string): { status: number } {
    // execSync (shell) is deliberate: pnpm is a .cmd shim on Windows, which
    // Node refuses to execFileSync without a shell. `fixture` is one of the
    // hardcoded directory names below, never external input.
    const dir = resolve(rootDir, "tests/dist-compat/fixtures", fixture);
    try {
      execSync(`pnpm exec tsgo -p "${dir}"`, { cwd: rootDir, stdio: "pipe" });
      return { status: 0 };
    } catch (error) {
      return { status: (error as { status?: number }).status ?? 1 };
    }
  }

  it("merges through the built d.ts", () => {
    expect(tsgo("zod-mini-global-args-merge").status).toBe(0);
  });

  it("negative control: a wrong assignment against the merged type is rejected", () => {
    expect(tsgo("zod-mini-global-args-merge-negative").status).not.toBe(0);
  });
});
