/**
 * Shell-level E2E tests for completion scripts.
 *
 * Tests that the generated shell scripts (bash/zsh/fish) correctly invoke
 * __complete and produce the expected completion candidates in each shell.
 *
 * Approach per shell:
 * - bash: Set COMP_WORDS/COMP_CWORD, call the completion function, read COMPREPLY
 * - zsh: Stub compdef/_describe/_files, set words array, call the completion function
 * - fish: Use `complete --do-complete` (built-in non-interactive completion query)
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const playgroundPath = path.resolve(
  import.meta.dirname,
  "../playground/24-shell-completion/index.ts",
);

function shellExists(shell: string): boolean {
  try {
    execSync(`which ${shell}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const hasBash = shellExists("bash");
const hasZsh = shellExists("zsh");
const hasFish = shellExists("fish");

let tmpDir: string;
let testEnv: NodeJS.ProcessEnv;
let testFilesDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "politty-completion-"));

  // CLI wrapper script — resolve tsx from project's node_modules (devDependency)
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const tsxBin = path.join(projectRoot, "node_modules", ".bin", "tsx");
  const wrapperPath = path.join(tmpDir, "myapp");
  fs.writeFileSync(wrapperPath, `#!/bin/sh\nexec ${tsxBin} ${playgroundPath} "$@"\n`, {
    mode: 0o755,
  });
  testEnv = { ...process.env, PATH: `${tmpDir}:${process.env.PATH}` };

  // Test filesystem for file/directory completion
  testFilesDir = path.join(tmpDir, "testfiles");
  fs.mkdirSync(testFilesDir);
  fs.mkdirSync(path.join(testFilesDir, "configs"));
  fs.mkdirSync(path.join(testFilesDir, "scripts"));
  fs.writeFileSync(path.join(testFilesDir, "app.json"), "{}");
  fs.writeFileSync(path.join(testFilesDir, "app.yaml"), "");
  fs.writeFileSync(path.join(testFilesDir, "deploy.yml"), "");
  fs.writeFileSync(path.join(testFilesDir, "readme.md"), "");
  fs.writeFileSync(path.join(testFilesDir, "index.ts"), "");
  // Files inside subdirectory
  fs.writeFileSync(path.join(testFilesDir, "configs", "prod.json"), "{}");
  fs.writeFileSync(path.join(testFilesDir, "configs", "dev.yaml"), "");
  fs.writeFileSync(path.join(testFilesDir, "configs", "notes.txt"), "");
});

afterAll(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

interface ExecOptions {
  cwd?: string;
}

/**
 * Bash: Set COMP_WORDS/COMP_CWORD and call the completion function directly.
 * This is the same approach used by cobra-completion-testing and bash-completion.
 */
function bashComplete(args: string[], opts?: ExecOptions): string[] {
  const compWords = ["myapp", ...args];
  const compCword = compWords.length - 1;
  const compLine = compWords.join(" ");

  const script = `
eval "$(myapp completion bash)"
COMP_WORDS=(${compWords.map((w) => `'${w}'`).join(" ")})
COMP_CWORD=${compCword}
COMP_LINE='${compLine}'
COMP_POINT=\${#COMP_LINE}
_myapp_completions 2>/dev/null
printf '%s\\n' "\${COMPREPLY[@]}"
`;

  const result = execSync(`bash -c '${script.replace(/'/g, "'\\''")}'`, {
    env: testEnv,
    encoding: "utf-8",
    timeout: 15000,
    cwd: opts?.cwd,
  });
  return result
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
}

/**
 * Zsh: Stub compdef/_describe/_files, set words array, call the function.
 * No zpty needed — the completion function uses `words` which we can set directly.
 *
 * _describe stub: extracts value (before colon) from each candidate.
 * _files stub: outputs __directive:file__ or __directive:directory__ to verify directive path.
 */
function zshComplete(args: string[], opts?: ExecOptions): string[] {
  const wordsArray = ["myapp", ...args];

  const script = `
compdef() {}
_describe() {
  shift
  local name=$1
  eval "local -a arr=(\\\${$\{name}[@]})"
  for item in "\${arr[@]}"; do
    echo "\${item%%:*}"
  done
}
_files() {
  if [[ "$1" == "-/" ]]; then
    echo "__directive:directory__"
  else
    echo "__directive:file__"
  fi
}
eval "$(myapp completion zsh)"
words=(${wordsArray.map((w) => `'${w}'`).join(" ")})
_myapp 2>/dev/null
`;

  const result = execSync(`zsh -f -c '${script.replace(/'/g, "'\\''")}'`, {
    env: testEnv,
    encoding: "utf-8",
    timeout: 15000,
    cwd: opts?.cwd,
  });
  return result
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
}

/**
 * Fish: Stub `commandline` to return controlled tokens, then call the
 * completion function directly.  This avoids fish-version-dependent
 * behaviour of `complete --do-complete` + `commandline -opc`.
 */
function fishComplete(args: string[], opts?: ExecOptions): string[] {
  // -opc returns all tokens up to cursor, excluding an empty trailing token
  const allTokens = ["myapp", ...args];
  const opcTokens = allTokens.filter((_, i) => i < allTokens.length - 1 || allTokens[i] !== "");
  const currentToken = args[args.length - 1] ?? "";

  const opcEchoLines = opcTokens.map((t) => `echo '${t}'`).join("\n    ");
  const ctBody = currentToken ? `echo '${currentToken}'` : "true";

  const script = `
function commandline
    if contains -- -opc $argv
        ${opcEchoLines}
    else if contains -- -ct $argv
        ${ctBody}
    end
end
source (myapp completion fish | psub)
__fish_myapp_complete
`;

  const result = execSync(`fish -c '${script.replace(/'/g, "'\\''")}'`, {
    env: testEnv,
    encoding: "utf-8",
    timeout: 15000,
    cwd: opts?.cwd,
  });
  return result
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.split("\t")[0]!);
}

type ShellCompleter = (args: string[], opts?: ExecOptions) => string[];

const shells: [string, boolean, ShellCompleter][] = [
  ["bash", hasBash, bashComplete],
  ["zsh", hasZsh, zshComplete],
  ["fish", hasFish, fishComplete],
];

// ─── Common tests across all shells ───────────────────────────────────────────

describe.each(shells)("%s completion", (_shell, available, complete) => {
  it.skipIf(!available)("completes subcommands at root level", () => {
    const values = complete([""]);
    expect(values).toContain("build");
    expect(values).toContain("deploy");
    expect(values).toContain("test");
    expect(values).toContain("completion");
  });

  it.skipIf(!available)("does not show __complete in subcommand list", () => {
    const values = complete([""]);
    expect(values).not.toContain("__complete");
  });

  it.skipIf(!available)("completes options for subcommand", () => {
    const values = complete(["build", "--"]);
    expect(values).toContain("--format");
    expect(values).toContain("--output");
    expect(values).toContain("--minify");
  });

  it.skipIf(!available)("completes enum values", () => {
    const values = complete(["build", "--format", ""]);
    expect(values).toContain("json");
    expect(values).toContain("yaml");
    expect(values).toContain("xml");
  });

  it.skipIf(!available)("completes custom choices", () => {
    const values = complete(["deploy", "--env", ""]);
    expect(values).toContain("development");
    expect(values).toContain("staging");
    expect(values).toContain("production");
  });

  it.skipIf(!available)("completes positional enum values", () => {
    const values = complete(["test", ""]);
    expect(values).toContain("unit");
    expect(values).toContain("integration");
    expect(values).toContain("e2e");
  });

  it.skipIf(!available)("filters out used options", () => {
    const values = complete(["deploy", "--env", "staging", "--"]);
    expect(values).not.toContain("--env");
    expect(values).toContain("--config");
    expect(values).toContain("--dry-run");
  });

  it.skipIf(!available)("completes completion subcommand shells", () => {
    const values = complete(["completion", ""]);
    expect(values).toContain("bash");
    expect(values).toContain("zsh");
    expect(values).toContain("fish");
  });

  it.skipIf(!available)(
    "returns file extension matches for deploy --config (resolved in JS)",
    () => {
      const values = complete(["deploy", "--config", ""], { cwd: testFilesDir });
      expect(values).toContain("app.json");
      expect(values).toContain("app.yaml");
      expect(values).toContain("deploy.yml");
      // Non-matching extensions should be excluded
      expect(values).not.toContain("readme.md");
      expect(values).not.toContain("index.ts");
      // Directories should be included for navigation
      expect(values.some((v) => v.startsWith("configs"))).toBe(true);
    },
  );

  it.skipIf(!available)("returns file extension matches with subdirectory path prefix", () => {
    const values = complete(["deploy", "--config", "configs/p"], {
      cwd: testFilesDir,
    });
    expect(values).toContain("configs/prod.json");
    // Non-matching prefix should be excluded
    expect(values).not.toContain("configs/dev.yaml");
    // Non-matching extensions should be excluded
    expect(values).not.toContain("configs/notes.txt");
  });
});

// ─── Bash-specific tests ──────────────────────────────────────────────────────

describe.skipIf(!hasBash)("bash-specific completion", () => {
  it("filters candidates by prefix", () => {
    const values = bashComplete(["deploy", "--env", "dev"]);
    expect(values).toContain("development");
    expect(values).not.toContain("staging");
    expect(values).not.toContain("production");
  });

  it("handles inline option value (--format=)", () => {
    const values = bashComplete(["build", "--format=j"]);
    expect(values).toContain("--format=json");
    expect(values).not.toContain("--format=yaml");
    expect(values).not.toContain("--format=xml");
  });

  it("handles inline option value with empty value (--format=)", () => {
    const values = bashComplete(["build", "--format="]);
    expect(values).toContain("--format=json");
    expect(values).toContain("--format=yaml");
    expect(values).toContain("--format=xml");
  });

  it("uses compgen -d for directory completion (build --output)", () => {
    const values = bashComplete(["build", "--output", ""], {
      cwd: testFilesDir,
    });
    expect(values).toContain("configs");
    expect(values).toContain("scripts");
    // Files should not appear in directory completion
    expect(values).not.toContain("app.json");
    expect(values).not.toContain("readme.md");
  });
});

// ─── Zsh-specific tests ──────────────────────────────────────────────────────

describe.skipIf(!hasZsh)("zsh-specific completion", () => {
  it("delegates to _files -/ for directory completion", () => {
    const values = zshComplete(["build", "--output", ""]);
    // Our _files stub returns __directive:directory__ for -/ flag
    expect(values).toContain("__directive:directory__");
  });
});
