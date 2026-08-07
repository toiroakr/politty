/**
 * Compatibility tests for the published `@politty/valibot` package, run
 * against BUILT output (`packages/valibot/dist`), not workspace sources.
 *
 * The headline guarantee here is the one that motivated the package
 * (issue #650): a valibot-based CLI must never load zod. The built dist is
 * scanned to prove zod is neither bundled nor imported, and the runtime
 * paths (entry, subpaths, bin) are exercised end-to-end.
 *
 * The dist is built once for the whole project in `global-setup.ts`.
 */

import { execFileSync, execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const valibotPkg = resolve(rootDir, "packages/valibot");
const valibotDist = resolve(valibotPkg, "dist");
const valibotBin = resolve(valibotPkg, "bin/cli.mjs");

function importDist(file: string): Promise<Record<string, unknown>> {
  return import(pathToFileURL(resolve(valibotDist, file)).href);
}

describe("@politty/valibot dist is zod-free", () => {
  it("neither imports zod nor carries zod's implementation inlined", () => {
    // Recursive: tsdown can emit shared chunks into subdirectories, and a
    // chunk that imports zod would defeat this test's whole purpose. The bin
    // launcher ships too (package.json `files`), so it is scanned as well.
    const distFiles = readdirSync(valibotDist, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(js|mjs|cjs)$/.test(f))
      .map((f) => resolve(valibotDist, f));
    expect(distFiles.length).toBeGreaterThan(0);
    for (const file of [...distFiles, valibotBin]) {
      const source = readFileSync(file, "utf8");
      const label = relative(valibotPkg, file);
      // Covers static/side-effect/dynamic imports and require, with optional
      // whitespace and zod subpaths ("zod/v4", "zod/mini", ...).
      expect(source, `${label} must not import zod`).not.toMatch(
        /(\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(?\s*)["']zod(\/[^"']+)?["']/,
      );
      // The specifier check above cannot see zod being *inlined*, which is the
      // likelier regression here: core is bundled in via `noExternal` and zod
      // is absent from this package's dependencies, so a zod import
      // reintroduced in core gets pulled in as source with no specifier left
      // to match. These identifiers are zod v4's own — its `$Zod*` classes and
      // tags, and the `_zod` internals property every zod schema carries. A
      // plain "zod" substring would not work: politty's output mentions zod
      // dozens of times in prose (JSDoc, one error message).
      expect(source, `${label} must not inline zod's implementation`).not.toMatch(
        /\$Zod[A-Z]|\b_zod\b/,
      );
    }
  });
});

describe("@politty/valibot dist runtime", () => {
  it("runs a valibot-schema command end-to-end through the built entry", async () => {
    const { defineCommand, runCommand } = (await importDist("index.js")) as {
      defineCommand: (def: unknown) => unknown;
      runCommand: (
        cmd: unknown,
        argv: string[],
      ) => Promise<{ success: boolean; result?: unknown; error?: Error }>;
    };
    const v = await import("valibot");

    const cmd = defineCommand({
      name: "greet",
      args: v.object({ name: v.string(), loud: v.optional(v.boolean(), false) }),
      run: (args: { name: string; loud: boolean }) => `hello ${args.name}${args.loud ? "!" : ""}`,
    });

    const ok = await runCommand(cmd, ["--name", "world", "--loud"]);
    expect(ok.success).toBe(true);
    expect(ok.result).toBe("hello world!");

    // Validation errors must keep the valibot adapter's rich messages.
    const bad = await runCommand(cmd, ["--name"]);
    expect(bad.success).toBe(false);
    expect(String(bad.error?.message)).toContain("Expected string");
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

describe("@politty/valibot bin", () => {
  it("politty bin runs from the built package", () => {
    const out = execFileSync(
      process.execPath,
      [resolve(rootDir, "packages/valibot/bin/cli.mjs"), "--help"],
      { encoding: "utf8" },
    );
    expect(out).toContain("politty");
    expect(out).toContain("Usage:");
  });
});

describe('declare module "@politty/valibot" GlobalArgs augmentation', () => {
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
    expect(tsgo("valibot-global-args-merge").status).toBe(0);
  });

  it("negative control: a wrong assignment against the merged type is rejected", () => {
    expect(tsgo("valibot-global-args-merge-negative").status).not.toBe(0);
  });
});
