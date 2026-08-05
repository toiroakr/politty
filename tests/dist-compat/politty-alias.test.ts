/**
 * Compatibility tests for the published `politty` alias, run against BUILT
 * output (`packages/politty/dist`), not workspace sources.
 *
 * Everything else in the test suite imports `packages/zod/src` directly, so
 * without this file nothing in CI executes the alias package existing
 * `politty` users install: its runtime re-exports, its subpath entries, its
 * bin, and the `declare module "politty"` GlobalArgs augmentation. The
 * beforeAll builds the workspace so the assertions always run against the
 * current sources.
 */

import { execFileSync, execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const polittyDist = resolve(rootDir, "packages/politty/dist");
const zodDist = resolve(rootDir, "packages/zod/dist");

function importDist(distDir: string, file: string): Promise<Record<string, unknown>> {
  return import(pathToFileURL(resolve(distDir, file)).href);
}

beforeAll(() => {
  // Always rebuild: a stale dist would silently test old code.
  execSync("pnpm -r build", { cwd: rootDir, stdio: "pipe" });
}, 180_000);

describe("politty alias runtime", () => {
  it("re-exports the same runtime objects as @politty/zod (single adapter registry)", async () => {
    const alias = await importDist(polittyDist, "index.js");
    const zod = await importDist(zodDist, "index.js");

    for (const name of ["defineCommand", "arg", "runMain", "runCommand", "extractFields"]) {
      expect(alias[name], name).toBeTypeOf("function");
      expect(alias[name], `${name} must be the same instance in both packages`).toBe(zod[name]);
    }
  });

  it("runs a zod-schema command end-to-end through the alias dist", async () => {
    const { defineCommand, runCommand } = (await importDist(polittyDist, "index.js")) as {
      defineCommand: (def: unknown) => unknown;
      runCommand: (
        cmd: unknown,
        argv: string[],
      ) => Promise<{ success: boolean; result?: unknown; error?: Error }>;
    };
    const { z } = await import("zod");

    const cmd = defineCommand({
      name: "greet",
      args: z.object({ name: z.string(), loud: z.boolean().default(false) }),
      run: (args: { name: string; loud: boolean }) => `hello ${args.name}${args.loud ? "!" : ""}`,
    });

    const ok = await runCommand(cmd, ["--name", "world", "--loud"]);
    expect(ok.success).toBe(true);
    expect(ok.result).toBe("hello world!");

    // Validation errors must keep the zod adapter's rich messages.
    const bad = await runCommand(cmd, ["--name"]);
    expect(bad.success).toBe(false);
    expect(String(bad.error?.message)).toContain("expected string");
  });

  it("exposes every documented subpath entry from dist", async () => {
    // prompt/clack and prompt/inquirer are omitted: their optional peer
    // deps are intentionally not installed at the workspace root.
    const entries = ["docs.js", "completion.js", "skill.js", "prompt.js", "compile-cache.js"];
    for (const entry of entries) {
      const mod = await importDist(polittyDist, entry);
      expect(Object.keys(mod).length, `${entry} should re-export something`).toBeGreaterThan(0);
    }
  });
});

describe("politty alias bin", () => {
  it("politty bin delegates to the @politty/zod CLI", () => {
    const out = execFileSync(
      process.execPath,
      [resolve(rootDir, "packages/politty/bin/cli.mjs"), "--help"],
      { encoding: "utf8" },
    );
    expect(out).toContain("politty");
    expect(out).toContain("Usage:");
  });
});

describe('declare module "politty" GlobalArgs augmentation', () => {
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

  it("merges through the alias dist d.ts", () => {
    expect(tsgo("global-args-merge").status).toBe(0);
  });

  it("negative control: a wrong assignment against the merged type is rejected", () => {
    expect(tsgo("global-args-merge-negative").status).not.toBe(0);
  });
});
