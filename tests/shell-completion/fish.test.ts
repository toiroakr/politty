import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defineCommonTests,
  fishComplete as fishCompleteRaw,
  hasFish,
  isCI,
  setupTestContext,
  teardownTestContext,
  type ExecOptions,
  type TestContext,
} from "./helpers.js";

let ctx: TestContext;

beforeAll(() => {
  ctx = setupTestContext();
});

afterAll(() => {
  teardownTestContext(ctx);
});

describe.runIf(isCI)("CI: required tools are available", () => {
  it("fish", () => expect(hasFish).toBe(true));
});

const complete = (args: string[], opts?: ExecOptions) => fishCompleteRaw(ctx.testEnv, args, opts);

// ─── Common tests ─────────────────────────────────────────────────────────────

describe.skipIf(!hasFish)("fish completion", () => {
  defineCommonTests(complete, () => ctx.testFilesDir);
});

// ─── Fish-specific tests ─────────────────────────────────────────────────────

describe.skipIf(!hasFish)("fish-specific completion", () => {
  it("completes files inside subdirectory", () => {
    const values = complete(["deploy", "--config", "configs/"], { cwd: ctx.testFilesDir });
    expect(values).toContain("configs/prod.json");
    expect(values).toContain("configs/dev.yaml");
    expect(values).not.toContain("configs/notes.txt");
  });
});

// ─── Fish interactive completion (complete --do-complete) ─────────────────────
//
// Uses fish's `complete --do-complete` to exercise the full completion pipeline
// including the -f flag that suppresses file fallback.

describe.skipIf(!hasFish)("fish interactive completion (complete --do-complete)", () => {
  function fishInteractiveComplete(args: string[], opts: { cwd: string }): number {
    const commandLine = ["myapp", ...args].join(" ");

    const script = [
      `set -x PATH "${ctx.tmpDir}" $PATH`,
      `source (myapp completion fish | psub)`,
      `cd "${opts.cwd}"`,
      `complete --do-complete "${commandLine}"`,
    ].join("\n");

    const result = execSync(`fish --no-config -c '${script.replace(/'/g, "'\\''")}'`, {
      env: ctx.testEnv,
      encoding: "utf-8",
      timeout: 15000,
    });

    const output = result.trim();
    if (output.length === 0) return 0;
    return output.split("\n").filter((l) => l.length > 0).length;
  }

  // ─── A. File extension filtering ──────────────────────────────────────────

  it("shows matching files and directories at root level", () => {
    const n = fishInteractiveComplete(["deploy", "--config", ""], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(8);
  });

  it("filters files in subdirectory", () => {
    const n = fishInteractiveComplete(["deploy", "--config", "configs/"], {
      cwd: ctx.testFilesDir,
    });
    expect(n).toBe(2);
  });

  it("does not fall back when no extensions match", () => {
    const n = fishInteractiveComplete(["deploy", "--config", "nomatch/"], {
      cwd: ctx.testFilesDir,
    });
    expect(n).toBe(0);
  });

  it("shows subdirectories for navigation", () => {
    const n = fishInteractiveComplete(["deploy", "--config", "nested/"], {
      cwd: ctx.testFilesDir,
    });
    expect(n).toBe(2);
  });

  it("filters in deeply nested directories", () => {
    const n = fishInteractiveComplete(["deploy", "--config", "nested/sub/"], {
      cwd: ctx.testFilesDir,
    });
    expect(n).toBe(1);
  });

  it("filters extension matches by filename prefix", () => {
    const n = fishInteractiveComplete(["deploy", "--config", "app"], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("completes files after multiple options", () => {
    const n = fishInteractiveComplete(["deploy", "--env", "staging", "--config", ""], {
      cwd: ctx.testFilesDir,
    });
    expect(n).toBeGreaterThanOrEqual(8);
  });

  // ─── B. Directory completion ──────────────────────────────────────────────

  it("shows only directories for directory completion", () => {
    const n = fishInteractiveComplete(["build", "--output", ""], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it("filters directories by prefix", () => {
    const n = fishInteractiveComplete(["build", "--output", "con"], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(1);
  });

  // ─── C. Enum / Choices ────────────────────────────────────────────────────

  it("completes enum values without file fallback", () => {
    const n = fishInteractiveComplete(["build", "--format", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  });

  it("filters enum values by prefix", () => {
    const n = fishInteractiveComplete(["build", "--format", "y"], { cwd: ctx.testFilesDir });
    expect(n).toBe(1);
  });

  it("completes custom choices without file fallback", () => {
    const n = fishInteractiveComplete(["deploy", "--env", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  });

  it("filters custom choices by prefix", () => {
    const n = fishInteractiveComplete(["deploy", "--env", "dev"], { cwd: ctx.testFilesDir });
    expect(n).toBe(1);
  });

  it("completes shell names for completion subcommand", () => {
    const n = fishInteractiveComplete(["completion", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  });

  it("completes choices via short alias", () => {
    const n = fishInteractiveComplete(["deploy", "-e", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  });

  // ─── D. Positional completion ─────────────────────────────────────────────

  it("completes positional enum values without file fallback", () => {
    const n = fishInteractiveComplete(["test", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  });

  it("completes first positional choices", () => {
    const n = fishInteractiveComplete(["migrate", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  });

  it("completes second positional with different choices", () => {
    const n = fishInteractiveComplete(["migrate", "local", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  });

  it("continues completing variadic positional", () => {
    const n = fishInteractiveComplete(["tag", "stable", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(4);
  });

  // ─── E. Subcommand / Option completion ────────────────────────────────────

  it("completes subcommands without file fallback", () => {
    const n = fishInteractiveComplete([""], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(6);
  });

  it("completes options for subcommand", () => {
    const n = fishInteractiveComplete(["build", "--"], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it("completes options after boolean flag", () => {
    const n = fishInteractiveComplete(["deploy", "--dry-run", "--"], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(2);
  });

  // ─── F. Edge cases ────────────────────────────────────────────────────────

  it("shows nothing after -- separator for command without positionals", () => {
    const n = fishInteractiveComplete(["deploy", "--", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(0);
  });

  it("completes positionals after -- separator", () => {
    const n = fishInteractiveComplete(["test", "--", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  });

  it("completes positional after interleaved option", () => {
    const n = fishInteractiveComplete(["migrate", "--dry-run", "local", ""], {
      cwd: ctx.testFilesDir,
    });
    expect(n).toBe(3);
  });
});
