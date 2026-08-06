/**
 * Vitest globalSetup for the `dist-compat` project: build the workspace
 * exactly once before any dist-compat test file runs.
 *
 * Every file in this project asserts against built output, and Vitest runs
 * test files in parallel — a per-file `beforeAll` rebuild would start one
 * `pnpm -r build` per file, all writing the same `dist/` directories. Since
 * tsdown builds with `clean: true`, a concurrent build can delete the
 * output another file is importing, which showed up as intermittent
 * failures. Building here keeps it to a single, serialized build.
 */

import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default function setup(): void {
  // Always rebuild: a stale dist would silently test old code. maxBuffer is
  // raised above the 1MB default so a verbose build can't kill the capture.
  try {
    execSync("pnpm -r build", { cwd: rootDir, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // stdio: "pipe" keeps successful builds quiet, so surface the captured
    // output when the build fails — otherwise CI shows only "command failed".
    const e = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `pnpm -r build failed:\n${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`,
    );
  }
}
