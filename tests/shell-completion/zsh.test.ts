import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defineCommonTests,
  hasZsh,
  isCI,
  setupTestContext,
  teardownTestContext,
  zshComplete as zshCompleteRaw,
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
  it("zsh", () => expect(hasZsh).toBe(true));
});

const complete = (args: string[], opts?: ExecOptions) => zshCompleteRaw(ctx.testEnv, args, opts);

// ─── Common tests ─────────────────────────────────────────────────────────────

describe.skipIf(!hasZsh)("zsh completion", () => {
  defineCommonTests(complete, () => ctx.testFilesDir);
});

// ─── Zsh-specific tests ──────────────────────────────────────────────────────

describe.skipIf(!hasZsh)("zsh-specific completion", () => {
  it("delegates to _files -/ for directory completion", () => {
    const values = complete(["build", "--output", ""]);
    expect(values).toContain("__directive:directory__");
  });

  it("uses _files -g for extension-filtered file completion", () => {
    const values = complete(["deploy", "--config", ""], { cwd: ctx.testFilesDir });
    expect(values).toContain("app.json");
    expect(values).toContain("app.yaml");
    expect(values).toContain("deploy.yml");
    expect(values).not.toContain("readme.md");
    expect(values).not.toContain("index.ts");
    expect(values).toContain("configs");
    expect(values).toContain("scripts");
  });

  it("completes files inside subdirectory", () => {
    const values = complete(["deploy", "--config", "configs/"], { cwd: ctx.testFilesDir });
    expect(values).toContain("configs/prod.json");
    expect(values).toContain("configs/dev.yaml");
    expect(values).not.toContain("configs/notes.txt");
  });

  it("does not fall back to default file completion when no extensions match", () => {
    const values = complete(["deploy", "--config", "nomatch/"], { cwd: ctx.testFilesDir });
    expect(values).not.toContain("nomatch/index.js");
    expect(values).not.toContain("nomatch/index.js.map");
    expect(values).not.toContain("nomatch/index.d.ts");
  });
});

// ─── Zsh interactive completion (zpty) ───────────────────────────────────────
//
// These tests use zpty (pseudo-terminal) to exercise the REAL zsh completion
// system, including the completer chain and file-patterns fallback behavior.
// Stub-based tests above cannot catch fallback bugs where _files -g shows
// all files when no pattern matches.

describe.skipIf(!hasZsh)("zsh interactive completion (zpty)", () => {
  /**
   * Assert nmatches for _describe-based completions.
   * _describe may internally call compadd -E1, adding an extra empty match
   * to compstate[nmatches]. This behavior is non-deterministic across runs,
   * so we accept either N or N+1 as valid.
   */
  function expectDescribeMatches(nmatches: number, expected: number) {
    expect(nmatches).toBeGreaterThanOrEqual(expected);
    expect(nmatches).toBeLessThanOrEqual(expected + 1);
  }

  /**
   * Run zsh completion interactively via zpty and return the number of matches.
   */
  function zshInteractiveComplete(args: string[], opts: { cwd: string }): number {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resultFile = path.join(ctx.tmpDir, `zpty-result-${ts}`);
    const setupFile = path.join(ctx.tmpDir, `zpty-setup-${ts}.zsh`);
    const mainFile = path.join(ctx.tmpDir, `zpty-main-${ts}.zsh`);
    const command = ["myapp", ...args].join(" ");

    const setupContent = [
      `export TERM=dumb`,
      `export PATH="${ctx.tmpDir}:$PATH"`,
      `autoload -Uz compinit && compinit -u 2>/dev/null`,
      `zstyle ':completion:*' completer _complete _files`,
      `eval "$(myapp completion zsh)" 2>/dev/null`,
      `comppostfuncs+=( _test_cap )`,
      `_test_cap() { echo $compstate[nmatches] > "${resultFile}" }`,
      `cd "${opts.cwd}"`,
    ].join("\n");
    fs.writeFileSync(setupFile, setupContent);

    const mainContent = `#!/usr/bin/env zsh -f
zmodload zsh/zpty || { echo "FAIL:zpty_unavailable"; exit 1 }

wait_output() {
  local pattern="$1" timeout="\${2:-10}"
  local out="" chunk=""
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    zpty -r tp chunk 2>/dev/null
    out+="$chunk"
    [[ "$out" == *\${~pattern}* ]] && return 0
    sleep 0.05
  done
  return 1
}

zpty -b tp zsh -f -i
wait_output '%' 5 || { echo "FAIL:no_prompt"; exit 1 }
zpty -w tp "source ${setupFile} && echo __DONE__"
wait_output '__DONE__' 15 || { echo "FAIL:setup_timeout"; exit 1 }
wait_output '%' 5

zpty -w -n tp "${command}"
sleep 0.5
zpty -w -n tp $'\\t'

local tries=50
while (( tries > 0 )); do
  [[ -f "${resultFile}" ]] && break
  sleep 0.2
  (( tries-- ))
done

if [[ -f "${resultFile}" ]]; then
  echo "NMATCHES:$(cat ${resultFile})"
else
  echo "NMATCHES:-1"
fi

zpty -d tp 2>/dev/null
`;
    fs.writeFileSync(mainFile, mainContent, { mode: 0o755 });

    try {
      const output = execSync(`zsh ${mainFile}`, {
        encoding: "utf-8",
        timeout: 30000,
      });

      const nmatchLine = output
        .trim()
        .split("\n")
        .find((l) => l.startsWith("NMATCHES:"));
      if (!nmatchLine) return -1;
      return Number.parseInt(nmatchLine.split(":")[1]!, 10);
    } finally {
      for (const f of [resultFile, setupFile, mainFile]) {
        try {
          fs.unlinkSync(f);
        } catch {}
      }
    }
  }

  it("does not fall back to showing all files when no extensions match", () => {
    const nmatches = zshInteractiveComplete(["deploy", "--config", "nomatch/"], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBe(0);
  });

  it("shows matching files and directories at root level", () => {
    const nmatches = zshInteractiveComplete(["deploy", "--config", ""], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBeGreaterThanOrEqual(8);
  });

  it("filters non-matching files in mixed directory", () => {
    const nmatches = zshInteractiveComplete(["deploy", "--config", "configs/"], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBe(2);
  });

  it("shows subdirectories for navigation alongside matching files", () => {
    const nmatches = zshInteractiveComplete(["deploy", "--config", "nested/"], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBe(2);
  });

  it("filters in deeply nested directories", () => {
    const nmatches = zshInteractiveComplete(["deploy", "--config", "nested/sub/"], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBe(1);
  });

  it("does not break DirectoryCompletion (build --output)", () => {
    const nmatches = zshInteractiveComplete(["build", "--output", ""], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBeGreaterThan(0);
  });

  it("filters extension matches by filename prefix", () => {
    const nmatches = zshInteractiveComplete(["deploy", "--config", "app"], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBeGreaterThanOrEqual(2);
  });

  it("completes files after multiple options", () => {
    const nmatches = zshInteractiveComplete(["deploy", "--env", "staging", "--config", ""], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBeGreaterThanOrEqual(8);
  });

  it("filters directories by prefix", () => {
    const nmatches = zshInteractiveComplete(["build", "--output", "con"], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBeGreaterThanOrEqual(1);
  });

  // ─── C. Enum / Choices ────────────────────────────────────────────────────

  it("completes enum values without file fallback", () => {
    const nmatches = zshInteractiveComplete(["build", "--format", ""], {
      cwd: ctx.testFilesDir,
    });
    expectDescribeMatches(nmatches, 3);
  });

  it("filters enum values by prefix", () => {
    const nmatches = zshInteractiveComplete(["build", "--format", "y"], {
      cwd: ctx.testFilesDir,
    });
    expectDescribeMatches(nmatches, 1);
  });

  it("completes custom choices without file fallback", () => {
    const nmatches = zshInteractiveComplete(["deploy", "--env", ""], {
      cwd: ctx.testFilesDir,
    });
    expectDescribeMatches(nmatches, 3);
  });

  it("filters custom choices by prefix", () => {
    const nmatches = zshInteractiveComplete(["deploy", "--env", "dev"], {
      cwd: ctx.testFilesDir,
    });
    expectDescribeMatches(nmatches, 1);
  });

  it("completes shell names for completion subcommand", () => {
    const nmatches = zshInteractiveComplete(["completion", ""], {
      cwd: ctx.testFilesDir,
    });
    expectDescribeMatches(nmatches, 3);
  });

  it("completes choices via short alias", () => {
    const nmatches = zshInteractiveComplete(["deploy", "-e", ""], {
      cwd: ctx.testFilesDir,
    });
    expectDescribeMatches(nmatches, 3);
  });

  // ─── D. Positional completion ─────────────────────────────────────────────

  it("completes positional enum values without file fallback", () => {
    const nmatches = zshInteractiveComplete(["test", ""], {
      cwd: ctx.testFilesDir,
    });
    expectDescribeMatches(nmatches, 3);
  });

  it("completes first positional choices", () => {
    const nmatches = zshInteractiveComplete(["migrate", ""], {
      cwd: ctx.testFilesDir,
    });
    expectDescribeMatches(nmatches, 3);
  });

  it("completes second positional with different choices", () => {
    const nmatches = zshInteractiveComplete(["migrate", "local", ""], {
      cwd: ctx.testFilesDir,
    });
    expectDescribeMatches(nmatches, 3);
  });

  it("continues completing variadic positional", () => {
    const nmatches = zshInteractiveComplete(["tag", "stable", ""], {
      cwd: ctx.testFilesDir,
    });
    expectDescribeMatches(nmatches, 4);
  });

  // ─── E. Subcommand / Option completion ────────────────────────────────────

  it("completes subcommands without file fallback", () => {
    const nmatches = zshInteractiveComplete([""], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBeGreaterThanOrEqual(6);
  });

  it("completes options for subcommand", () => {
    const nmatches = zshInteractiveComplete(["build", "--"], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBeGreaterThanOrEqual(3);
  });

  it("completes options after boolean flag", () => {
    const nmatches = zshInteractiveComplete(["deploy", "--dry-run", "--"], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBeGreaterThanOrEqual(2);
  });

  // ─── F. Edge cases ────────────────────────────────────────────────────────

  it("shows nothing after -- separator for command without positionals", () => {
    const nmatches = zshInteractiveComplete(["deploy", "--", ""], {
      cwd: ctx.testFilesDir,
    });
    expect(nmatches).toBe(0);
  });

  it("completes positionals after -- separator", () => {
    const nmatches = zshInteractiveComplete(["test", "--", ""], {
      cwd: ctx.testFilesDir,
    });
    expectDescribeMatches(nmatches, 3);
  });

  it("completes positional after interleaved option", () => {
    const nmatches = zshInteractiveComplete(["migrate", "--dry-run", "local", ""], {
      cwd: ctx.testFilesDir,
    });
    expectDescribeMatches(nmatches, 3);
  });
});
