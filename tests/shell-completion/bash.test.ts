import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bashComplete as bashCompleteRaw,
  defineCommonTests,
  hasBash,
  hasExpect,
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
  it("bash", () => expect(hasBash).toBe(true));
  it("expect", () => expect(hasExpect).toBe(true));
});

const complete = (args: string[], opts?: ExecOptions) => bashCompleteRaw(ctx.testEnv, args, opts);

// ─── Common tests ─────────────────────────────────────────────────────────────

describe.skipIf(!hasBash)("bash completion", () => {
  defineCommonTests(complete, () => ctx.testFilesDir);
});

// ─── Bash-specific tests ──────────────────────────────────────────────────────

describe.skipIf(!hasBash)("bash-specific completion", () => {
  it("filters candidates by prefix", () => {
    const values = complete(["deploy", "--env", "dev"]);
    expect(values).toContain("development");
    expect(values).not.toContain("staging");
    expect(values).not.toContain("production");
  });

  it("handles inline option value (--format=)", () => {
    const values = complete(["build", "--format=j"]);
    expect(values).toContain("--format=json");
    expect(values).not.toContain("--format=yaml");
    expect(values).not.toContain("--format=xml");
  });

  it("handles inline option value with empty value (--format=)", () => {
    const values = complete(["build", "--format="]);
    expect(values).toContain("--format=json");
    expect(values).toContain("--format=yaml");
    expect(values).toContain("--format=xml");
  });

  it("uses compgen -d for directory completion (build --output)", () => {
    const values = complete(["build", "--output", ""], {
      cwd: ctx.testFilesDir,
    });
    expect(values).toContain("configs");
    expect(values).toContain("scripts");
    expect(values).not.toContain("app.json");
    expect(values).not.toContain("readme.md");
  });

  it("includes directories for file extension completion navigation", () => {
    const values = complete(["deploy", "--config", ""], { cwd: ctx.testFilesDir });
    expect(values).toContain("configs");
    expect(values).toContain("scripts");
  });

  it("completes files inside subdirectory after directory selection", () => {
    const values = complete(["deploy", "--config", "configs/"], { cwd: ctx.testFilesDir });
    expect(values).toContain("configs/prod.json");
    expect(values).toContain("configs/dev.yaml");
    expect(values).not.toContain("configs/notes.txt");
  });

  it("filters directory completion by prefix", () => {
    const values = complete(["build", "--output", "con"], { cwd: ctx.testFilesDir });
    expect(values).toContain("configs");
    expect(values).not.toContain("scripts");
    expect(values).not.toContain("empty");
  });

  it("handles inline directory completion (--output=con)", () => {
    const values = complete(["build", "--output=con"], { cwd: ctx.testFilesDir });
    expect(values).toContain("--output=configs");
    expect(values).not.toContain("--output=scripts");
    expect(values).not.toContain("--output=empty");
  });

  it("handles inline file extension completion (--config=app)", () => {
    const values = complete(["deploy", "--config=app"], { cwd: ctx.testFilesDir });
    expect(values).toContain("--config=app.json");
    expect(values).toContain("--config=app.yaml");
    expect(values).not.toContain("--config=readme.md");
  });

  it("does not leak stale COMPREPLY across invocations", () => {
    const script = `
eval "$(myapp completion bash)"
COMP_WORDS=('myapp' '')
COMP_CWORD=1
COMP_LINE='myapp '
COMP_POINT=\${#COMP_LINE}
_myapp_completions 2>/dev/null
COMP_WORDS=('myapp' 'deploy' '--config' '')
COMP_CWORD=3
COMP_LINE='myapp deploy --config '
COMP_POINT=\${#COMP_LINE}
_myapp_completions 2>/dev/null
printf '%s\\n' "\${COMPREPLY[@]}"
`;
    const result = execSync(`bash -c '${script.replace(/'/g, "'\\''")}'`, {
      env: ctx.testEnv,
      encoding: "utf-8",
      timeout: 15000,
      cwd: ctx.testFilesDir,
    });
    const values = result
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    expect(values).not.toContain("build");
    expect(values).not.toContain("deploy");
    expect(values).toContain("app.json");
  });
});

// ─── Bash interactive completion (expect) ─────────────────────────────────────
//
// Uses expect to drive a real interactive bash session with readline.
// This is critical for testing compopt +o default which only works in
// a readline completion context (stubs swallow it with 2>/dev/null).

describe.skipIf(!hasBash || !hasExpect)("bash interactive completion (expect)", () => {
  function bashInteractiveComplete(args: string[], opts: { cwd: string }): number {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resultFile = path.join(ctx.tmpDir, `bash-result-${ts}`);
    const setupFile = path.join(ctx.tmpDir, `bash-setup-${ts}.sh`);
    const expectFile = path.join(ctx.tmpDir, `bash-expect-${ts}.exp`);
    const command = ["myapp", ...args].join(" ");

    const setupContent = [
      `export PS1='READY> '`,
      `export PATH="${ctx.tmpDir}:$PATH"`,
      `eval "$(myapp completion bash)"`,
      `_myapp_wrapper() { _myapp_completions; echo \${#COMPREPLY[@]} > "${resultFile}"; }`,
      `complete -o default -F _myapp_wrapper myapp`,
      `cd "${opts.cwd}"`,
    ].join("\n");
    fs.writeFileSync(setupFile, setupContent);

    const expectContent = [
      `#!/usr/bin/expect -f`,
      `set timeout 15`,
      `spawn bash --norc --noprofile`,
      `expect "$ "`,
      `send "source ${setupFile}\\r"`,
      `expect "READY> "`,
      `send "${command}\\t"`,
      `after 2000`,
      `send "\\x03"`,
      `expect "READY> "`,
      `send "exit\\r"`,
      `expect eof`,
    ].join("\n");
    fs.writeFileSync(expectFile, expectContent, { mode: 0o755 });

    try {
      execSync(`expect ${expectFile}`, {
        env: ctx.testEnv,
        encoding: "utf-8",
        timeout: 30000,
        stdio: "pipe",
      });
      if (fs.existsSync(resultFile)) {
        return Number.parseInt(fs.readFileSync(resultFile, "utf-8").trim(), 10);
      }
      return -1;
    } finally {
      for (const f of [resultFile, setupFile, expectFile]) {
        try {
          fs.unlinkSync(f);
        } catch {}
      }
    }
  }

  // ─── A. File extension filtering ──────────────────────────────────────────

  it("shows matching files and directories at root level", () => {
    const n = bashInteractiveComplete(["deploy", "--config", ""], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(8);
  }, 30000);

  it("filters files in subdirectory", () => {
    const n = bashInteractiveComplete(["deploy", "--config", "configs/"], {
      cwd: ctx.testFilesDir,
    });
    expect(n).toBe(2);
  }, 30000);

  it("does not fall back when no extensions match", () => {
    const n = bashInteractiveComplete(["deploy", "--config", "nomatch/"], {
      cwd: ctx.testFilesDir,
    });
    expect(n).toBe(0);
  }, 30000);

  it("shows subdirectories for navigation", () => {
    const n = bashInteractiveComplete(["deploy", "--config", "nested/"], {
      cwd: ctx.testFilesDir,
    });
    expect(n).toBe(2);
  }, 30000);

  it("filters in deeply nested directories", () => {
    const n = bashInteractiveComplete(["deploy", "--config", "nested/sub/"], {
      cwd: ctx.testFilesDir,
    });
    expect(n).toBe(1);
  }, 30000);

  it("filters extension matches by filename prefix", () => {
    const n = bashInteractiveComplete(["deploy", "--config", "app"], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("completes files after multiple options", () => {
    const n = bashInteractiveComplete(["deploy", "--env", "staging", "--config", ""], {
      cwd: ctx.testFilesDir,
    });
    expect(n).toBeGreaterThanOrEqual(8);
  }, 30000);

  // ─── B. Directory completion ──────────────────────────────────────────────

  it("shows only directories for directory completion", () => {
    const n = bashInteractiveComplete(["build", "--output", ""], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(3);
  }, 30000);

  it("filters directories by prefix", () => {
    const n = bashInteractiveComplete(["build", "--output", "con"], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(1);
  }, 30000);

  // ─── C. Enum / Choices ────────────────────────────────────────────────────

  it("completes enum values without file fallback", () => {
    const n = bashInteractiveComplete(["build", "--format", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  }, 30000);

  it("filters enum values by prefix", () => {
    const n = bashInteractiveComplete(["build", "--format", "y"], { cwd: ctx.testFilesDir });
    expect(n).toBe(1);
  }, 30000);

  it("completes custom choices without file fallback", () => {
    const n = bashInteractiveComplete(["deploy", "--env", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  }, 30000);

  it("filters custom choices by prefix", () => {
    const n = bashInteractiveComplete(["deploy", "--env", "dev"], { cwd: ctx.testFilesDir });
    expect(n).toBe(1);
  }, 30000);

  it("completes shell names for completion subcommand", () => {
    const n = bashInteractiveComplete(["completion", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  }, 30000);

  it("completes choices via short alias", () => {
    const n = bashInteractiveComplete(["deploy", "-e", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  }, 30000);

  // ─── D. Positional completion ─────────────────────────────────────────────

  it("completes positional enum values without file fallback", () => {
    const n = bashInteractiveComplete(["test", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  }, 30000);

  it("completes first positional choices", () => {
    const n = bashInteractiveComplete(["migrate", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  }, 30000);

  it("completes second positional with different choices", () => {
    const n = bashInteractiveComplete(["migrate", "local", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  }, 30000);

  it("continues completing variadic positional", () => {
    const n = bashInteractiveComplete(["tag", "stable", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(4);
  }, 30000);

  // ─── E. Subcommand / Option completion ────────────────────────────────────

  it("completes subcommands without file fallback", () => {
    const n = bashInteractiveComplete([""], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(6);
  }, 30000);

  it("completes options for subcommand", () => {
    const n = bashInteractiveComplete(["build", "--"], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(3);
  }, 30000);

  it("completes options after boolean flag", () => {
    const n = bashInteractiveComplete(["deploy", "--dry-run", "--"], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(2);
  }, 30000);

  // ─── F. Edge cases ────────────────────────────────────────────────────────

  it("shows nothing after -- separator for command without positionals", () => {
    const n = bashInteractiveComplete(["deploy", "--", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(0);
  }, 30000);

  it("completes positionals after -- separator", () => {
    const n = bashInteractiveComplete(["test", "--", ""], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  }, 30000);

  it("completes positional after interleaved option", () => {
    const n = bashInteractiveComplete(["migrate", "--dry-run", "local", ""], {
      cwd: ctx.testFilesDir,
    });
    expect(n).toBe(3);
  }, 30000);

  // ─── Bash-specific: inline --opt=value ────────────────────────────────────

  it("completes inline enum values (--format=)", () => {
    const n = bashInteractiveComplete(["build", "--format="], { cwd: ctx.testFilesDir });
    expect(n).toBe(3);
  }, 30000);

  it("filters inline enum by prefix (--format=j)", () => {
    const n = bashInteractiveComplete(["build", "--format=j"], { cwd: ctx.testFilesDir });
    expect(n).toBe(1);
  }, 30000);

  it("completes inline file extension (--config=app)", () => {
    const n = bashInteractiveComplete(["deploy", "--config=app"], { cwd: ctx.testFilesDir });
    expect(n).toBeGreaterThanOrEqual(2);
  }, 30000);
});
