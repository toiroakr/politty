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

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "politty-completion-"));
  const wrapperPath = path.join(tmpDir, "myapp");
  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexec ${process.execPath} --import tsx ${playgroundPath} "$@"\n`,
    { mode: 0o755 },
  );
  testEnv = { ...process.env, PATH: `${tmpDir}:${process.env.PATH}` };
});

afterAll(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * Bash: Set COMP_WORDS/COMP_CWORD and call the completion function directly.
 * This is the same approach used by cobra-completion-testing and bash-completion.
 */
function bashComplete(args: string[]): string[] {
  // COMP_WORDS: ["myapp", ...args]
  // COMP_CWORD: index of the word being completed (last element)
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
  });
  return result
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
}

/**
 * Zsh: Stub compdef/_describe/_files, set words array, call the function.
 * No zpty needed — the completion function uses `words` which we can set directly.
 */
function zshComplete(args: string[]): string[] {
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
  });
  return result
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
}

/**
 * Fish: Use `complete --do-complete` for non-interactive completion query.
 */
function fishComplete(args: string[]): string[] {
  const cmdLine = ["myapp", ...args].join(" ");

  const result = execSync(
    `fish -c 'source (myapp completion fish | psub); complete --do-complete "${cmdLine}"'`,
    {
      env: testEnv,
      encoding: "utf-8",
      timeout: 15000,
    },
  );
  return result
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.split("\t")[0]!);
}

type ShellCompleter = (args: string[]) => string[];

const shells: [string, boolean, ShellCompleter][] = [
  ["bash", hasBash, bashComplete],
  ["zsh", hasZsh, zshComplete],
  ["fish", hasFish, fishComplete],
];

describe.each(shells)("%s completion", (_shell, available, complete) => {
  it.skipIf(!available)("completes subcommands at root level", () => {
    const values = complete([""]);
    expect(values).toContain("build");
    expect(values).toContain("deploy");
    expect(values).toContain("test");
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
});
