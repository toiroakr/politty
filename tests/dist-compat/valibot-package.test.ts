/**
 * Compatibility tests for the published `@politty/valibot` package, run
 * against BUILT output (`packages/valibot/dist`), not workspace sources.
 *
 * The headline guarantee here is the one that motivated the package
 * (issue #650): a valibot-based CLI must never load zod. The built dist is
 * scanned to prove zod is neither bundled nor imported, and the runtime
 * paths (entry, subpaths, bin) are exercised end-to-end.
 */

import { execFileSync, execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const valibotDist = resolve(rootDir, "packages/valibot/dist");

function importDist(file: string): Promise<Record<string, unknown>> {
  return import(pathToFileURL(resolve(valibotDist, file)).href);
}

beforeAll(() => {
  // Always rebuild: a stale dist would silently test old code.
  execSync("pnpm -r build", { cwd: rootDir, stdio: "pipe" });
}, 180_000);

describe("@politty/valibot dist is zod-free", () => {
  it("never bundles or imports zod in any built module", () => {
    // Recursive: tsdown can emit shared chunks into subdirectories, and a
    // chunk that imports zod would defeat this test's whole purpose.
    const jsFiles = readdirSync(valibotDist, { recursive: true, encoding: "utf8" }).filter((f) =>
      /\.(js|mjs|cjs)$/.test(f),
    );
    expect(jsFiles.length).toBeGreaterThan(0);
    for (const file of jsFiles) {
      const source = readFileSync(resolve(valibotDist, file), "utf8");
      // Covers static/side-effect/dynamic imports and require, with optional
      // whitespace and zod subpaths ("zod/v4", "zod/mini", ...).
      expect(source, `${file} must not reference zod`).not.toMatch(
        /(\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(?\s*)["']zod(\/[^"']+)?["']/,
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
