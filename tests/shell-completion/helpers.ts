/**
 * Shared utilities for shell completion tests.
 *
 * Provides test environment setup, shell completers, and common test definitions
 * used across bash, zsh, and fish test files.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const playgroundPath = path.resolve(
  import.meta.dirname,
  "../../playground/24-shell-completion/index.ts",
);

export function shellExists(shell: string): boolean {
  try {
    execSync(`which ${shell}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export const hasBash = shellExists("bash");
export const hasZsh = shellExists("zsh");
export const hasFish = shellExists("fish");
export const hasExpect = shellExists("expect");
export const isCI = !!process.env.CI;

export interface ExecOptions {
  cwd?: string;
}

export interface TestContext {
  tmpDir: string;
  testEnv: NodeJS.ProcessEnv;
  testFilesDir: string;
}

export function setupTestContext(): TestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "politty-completion-"));

  const projectRoot = path.resolve(import.meta.dirname, "../..");
  const tsxBin = path.join(projectRoot, "node_modules", ".bin", "tsx");
  const wrapperPath = path.join(tmpDir, "myapp");
  fs.writeFileSync(wrapperPath, `#!/bin/sh\nexec ${tsxBin} ${playgroundPath} "$@"\n`, {
    mode: 0o755,
  });
  const testEnv = { ...process.env, PATH: `${tmpDir}:${process.env.PATH}` };

  const testFilesDir = path.join(tmpDir, "testfiles");
  fs.mkdirSync(testFilesDir);
  fs.mkdirSync(path.join(testFilesDir, "configs"));
  fs.mkdirSync(path.join(testFilesDir, "scripts"));
  fs.writeFileSync(path.join(testFilesDir, "app.json"), "{}");
  fs.writeFileSync(path.join(testFilesDir, "app.yaml"), "");
  fs.writeFileSync(path.join(testFilesDir, "deploy.yml"), "");
  fs.writeFileSync(path.join(testFilesDir, "readme.md"), "");
  fs.writeFileSync(path.join(testFilesDir, "index.ts"), "");
  fs.writeFileSync(path.join(testFilesDir, "configs", "prod.json"), "{}");
  fs.writeFileSync(path.join(testFilesDir, "configs", "dev.yaml"), "");
  fs.writeFileSync(path.join(testFilesDir, "configs", "notes.txt"), "");
  fs.mkdirSync(path.join(testFilesDir, "empty"));
  fs.mkdirSync(path.join(testFilesDir, "nomatch"));
  fs.writeFileSync(path.join(testFilesDir, "nomatch", "index.js"), "");
  fs.writeFileSync(path.join(testFilesDir, "nomatch", "index.js.map"), "");
  fs.writeFileSync(path.join(testFilesDir, "nomatch", "index.d.ts"), "");
  fs.mkdirSync(path.join(testFilesDir, "nested", "sub"), { recursive: true });
  fs.writeFileSync(path.join(testFilesDir, "nested", "base.json"), "{}");
  fs.writeFileSync(path.join(testFilesDir, "nested", "sub", "deep.json"), "{}");
  fs.writeFileSync(path.join(testFilesDir, "nested", "sub", "deep.txt"), "");

  return { tmpDir, testEnv, testFilesDir };
}

export function teardownTestContext(ctx: TestContext): void {
  if (ctx.tmpDir) {
    fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
  }
}

export function bashComplete(
  testEnv: NodeJS.ProcessEnv,
  args: string[],
  opts?: ExecOptions,
): string[] {
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

export function zshComplete(
  testEnv: NodeJS.ProcessEnv,
  args: string[],
  opts?: ExecOptions,
): string[] {
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
  elif [[ "$1" == "-g" ]]; then
    local pat="$2" cur="\${words[-1]}" dir="" prefix=""
    if [[ -z "$cur" || "$cur" != */* ]]; then
      dir="." prefix="$cur"
    elif [[ "$cur" == */ ]]; then
      dir="\${cur%/}" prefix=""
    else
      dir="\${cur%/*}" prefix="\${cur##*/}"
    fi
    setopt null_glob
    local f
    for f in \${~dir}/\${prefix}\${~pat}(N); do
      [[ -f "$f" ]] && { [[ "$dir" == "." ]] && echo "\${f#./}" || echo "$f" }
    done
    for f in "\${dir}"/\${prefix}*(N/); do
      [[ "$dir" == "." ]] && echo "\${f#./}" || echo "$f"
    done
    unsetopt null_glob
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

export function fishComplete(
  testEnv: NodeJS.ProcessEnv,
  args: string[],
  opts?: ExecOptions,
): string[] {
  const allTokens = ["myapp", ...args];
  const opcTokens = allTokens.slice(0, -1);
  const currentToken = args[args.length - 1] ?? "";

  const opcEchoLines = opcTokens.map((t) => `printf '%s\\n' '${t}'`).join("\n    ");
  const ctBody = currentToken ? `printf '%s\\n' '${currentToken}'` : "true";

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

/**
 * Register common completion test cases that are shared across all shells.
 * Must be called inside a describe() block.
 */
export function defineCommonTests(
  complete: (args: string[], opts?: ExecOptions) => string[],
  getTestFilesDir: () => string,
): void {
  it("completes subcommands at root level", () => {
    const values = complete([""]);
    expect(values).toContain("build");
    expect(values).toContain("deploy");
    expect(values).toContain("test");
    expect(values).toContain("completion");
  });

  it("does not show __complete in subcommand list", () => {
    const values = complete([""]);
    expect(values).not.toContain("__complete");
  });

  it("completes options for subcommand", () => {
    const values = complete(["build", "--"]);
    expect(values).toContain("--format");
    expect(values).toContain("--output");
    expect(values).toContain("--minify");
  });

  it("completes enum values", () => {
    const values = complete(["build", "--format", ""]);
    expect(values).toContain("json");
    expect(values).toContain("yaml");
    expect(values).toContain("xml");
  });

  it("completes custom choices", () => {
    const values = complete(["deploy", "--env", ""]);
    expect(values).toContain("development");
    expect(values).toContain("staging");
    expect(values).toContain("production");
  });

  it("completes positional enum values", () => {
    const values = complete(["test", ""]);
    expect(values).toContain("unit");
    expect(values).toContain("integration");
    expect(values).toContain("e2e");
  });

  it("filters out used options", () => {
    const values = complete(["deploy", "--env", "staging", "--"]);
    expect(values).not.toContain("--env");
    expect(values).toContain("--config");
    expect(values).toContain("--dry-run");
  });

  it("completes completion subcommand shells", () => {
    const values = complete(["completion", ""]);
    expect(values).toContain("bash");
    expect(values).toContain("zsh");
    expect(values).toContain("fish");
  });

  it("returns file extension matches for deploy --config (resolved in JS)", () => {
    const values = complete(["deploy", "--config", ""], { cwd: getTestFilesDir() });
    expect(values).toContain("app.json");
    expect(values).toContain("app.yaml");
    expect(values).toContain("deploy.yml");
    expect(values).not.toContain("readme.md");
    expect(values).not.toContain("index.ts");
  });

  it("returns file extension matches with subdirectory path prefix", () => {
    const values = complete(["deploy", "--config", "configs/p"], {
      cwd: getTestFilesDir(),
    });
    expect(values).toContain("configs/prod.json");
    expect(values).not.toContain("configs/dev.yaml");
    expect(values).not.toContain("configs/notes.txt");
  });

  it("filters file extension matches by filename prefix", () => {
    const values = complete(["deploy", "--config", "app"], { cwd: getTestFilesDir() });
    expect(values).toContain("app.json");
    expect(values).toContain("app.yaml");
    expect(values).not.toContain("deploy.yml");
  });

  it("returns empty for non-existent directory path", () => {
    const values = complete(["deploy", "--config", "nonexistent/"], { cwd: getTestFilesDir() });
    expect(values.filter((v) => v.startsWith("nonexistent/"))).toHaveLength(0);
  });

  it("returns no file matches inside empty directory", () => {
    const values = complete(["deploy", "--config", "empty/"], { cwd: getTestFilesDir() });
    expect(values.filter((v) => v.startsWith("empty/"))).toHaveLength(0);
  });

  it("does not show non-matching files in directory with no extension matches", () => {
    const values = complete(["deploy", "--config", "nomatch/"], { cwd: getTestFilesDir() });
    expect(values).not.toContain("nomatch/index.js");
    expect(values).not.toContain("nomatch/index.js.map");
    expect(values).not.toContain("nomatch/index.d.ts");
  });

  it("completes options after boolean flag (no value consumed)", () => {
    const values = complete(["deploy", "--dry-run", "--"]);
    expect(values).toContain("--env");
    expect(values).toContain("--config");
    expect(values).not.toContain("--dry-run");
  });

  it("completes files inside subdirectory via trailing slash", () => {
    const values = complete(["deploy", "--config", "configs/"], { cwd: getTestFilesDir() });
    expect(values).toContain("configs/prod.json");
    expect(values).toContain("configs/dev.yaml");
    expect(values).not.toContain("configs/notes.txt");
  });

  it("completes option value after short alias", () => {
    const values = complete(["deploy", "-e", ""]);
    expect(values).toContain("development");
    expect(values).toContain("staging");
    expect(values).toContain("production");
  });

  it("filters out option used via short alias", () => {
    const values = complete(["deploy", "-e", "staging", "--"]);
    expect(values).not.toContain("--env");
    expect(values).toContain("--config");
    expect(values).toContain("--dry-run");
  });

  it("completes options after positional argument", () => {
    const values = complete(["test", "unit", "--"]);
    expect(values).toContain("--watch");
    expect(values).toContain("--help");
  });

  it("completes file after multiple options", () => {
    const values = complete(["deploy", "--env", "staging", "--config", ""], {
      cwd: getTestFilesDir(),
    });
    expect(values).toContain("app.json");
    expect(values).toContain("app.yaml");
    expect(values).toContain("deploy.yml");
  });

  // ─── Multiple positionals ──────────────────────────────────────────────────

  it("completes first positional choices", () => {
    const values = complete(["migrate", ""]);
    expect(values).toContain("local");
    expect(values).toContain("staging");
    expect(values).toContain("production");
  });

  it("completes second positional with different choices", () => {
    const values = complete(["migrate", "local", ""]);
    expect(values).toContain("dev");
    expect(values).toContain("qa");
    expect(values).toContain("prod");
    expect(values).not.toContain("local");
    expect(values).not.toContain("staging");
    expect(values).not.toContain("production");
  });

  it("completes options after all positionals provided", () => {
    const values = complete(["migrate", "local", "dev", "--"]);
    expect(values).toContain("--dry-run");
    expect(values).toContain("--verbose");
    expect(values).toContain("--help");
  });

  // ─── Array (variadic) positional ───────────────────────────────────────────

  it("completes array positional enum values", () => {
    const values = complete(["tag", ""]);
    expect(values).toContain("stable");
    expect(values).toContain("beta");
    expect(values).toContain("nightly");
    expect(values).toContain("rc");
  });

  it("continues completing array positional after first value", () => {
    const values = complete(["tag", "stable", ""]);
    expect(values).toContain("stable");
    expect(values).toContain("beta");
    expect(values).toContain("nightly");
    expect(values).toContain("rc");
  });

  it("completes options after array positional values", () => {
    const values = complete(["tag", "stable", "beta", "--"]);
    expect(values).toContain("--force");
    expect(values).toContain("--help");
  });

  // ─── Options interleaved with positionals ──────────────────────────────────

  it("completes positional after interleaved option (option before positional)", () => {
    const values = complete(["migrate", "--dry-run", "local", ""]);
    expect(values).toContain("dev");
    expect(values).toContain("qa");
    expect(values).toContain("prod");
    expect(values).not.toContain("local");
  });

  it("completes positional after trailing boolean flag (positional before option)", () => {
    const values = complete(["migrate", "local", "--dry-run", ""]);
    expect(values).toContain("dev");
    expect(values).toContain("qa");
    expect(values).toContain("prod");
    expect(values).not.toContain("local");
    expect(values).not.toContain("staging");
    expect(values).not.toContain("production");
  });

  it("completes variadic positional after interleaved option", () => {
    const values = complete(["tag", "--force", "stable", ""]);
    expect(values).toContain("beta");
    expect(values).toContain("nightly");
    expect(values).toContain("rc");
  });

  // ─── Double-dash separator ─────────────────────────────────────────────────

  it("does not show options after -- for command without positionals", () => {
    const values = complete(["deploy", "--"]);
    expect(values).toContain("--env");
    const valuesAfter = complete(["deploy", "--", ""]);
    expect(valuesAfter).not.toContain("--env");
    expect(valuesAfter).not.toContain("--config");
    expect(valuesAfter).not.toContain("--dry-run");
  }, 15000);

  it("completes positional after -- separator", () => {
    const values = complete(["test", "--", ""]);
    expect(values).toContain("unit");
    expect(values).toContain("integration");
    expect(values).toContain("e2e");
  });

  it("completes options after boolean flag in variadic command", () => {
    const values = complete(["tag", "--force", "--"]);
    expect(values).toContain("--help");
    expect(values).not.toContain("stable");
    expect(values).not.toContain("beta");
  });

  it("completes options with short alias and file completion", () => {
    const values = complete(["deploy", "-e", "staging", "-c", ""], {
      cwd: getTestFilesDir(),
    });
    expect(values).toContain("app.json");
    expect(values).toContain("app.yaml");
    expect(values).toContain("deploy.yml");
  });

  it("shows options after inline = value", () => {
    const values = complete(["build", "--format=json", "--"]);
    expect(values).not.toContain("--format");
    expect(values).toContain("--output");
    expect(values).toContain("--minify");
  });
}
