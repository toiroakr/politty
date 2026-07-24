import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function isGitIgnored(relativePath: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", relativePath], { cwd: rootDir });
    return true;
  } catch (error) {
    // `git check-ignore -q` uses exit code 1 specifically for "not ignored";
    // any other failure (git missing, invalid path, ...) must not be read as
    // "not ignored" or the test could pass without checking anything.
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
}

describe("package.json bin", () => {
  // pnpm only symlinks a `bin` whose target exists at install time. If the
  // target lives under a gitignored build output directory (e.g. dist/),
  // a clean checkout of a workspace consumer has no dist/ yet, so pnpm
  // silently skips the node_modules/.bin link and never retries it
  // (pnpm/pnpm#10524, #6221, #5570).
  const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
  const binPath = pkg.bin.politty as string;
  const relativePath = binPath.replace(/^\.\//, "");

  it("does not point at a gitignored build artifact", () => {
    expect(isGitIgnored(relativePath)).toBe(false);
  });

  it("points at a file that exists without a build step", () => {
    expect(existsSync(resolve(rootDir, relativePath))).toBe(true);
  });
});
