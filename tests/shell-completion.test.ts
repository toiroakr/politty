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
  // Empty directory
  fs.mkdirSync(path.join(testFilesDir, "empty"));
  // Directory with only non-matching files (no .json/.yaml/.yml)
  fs.mkdirSync(path.join(testFilesDir, "nomatch"));
  fs.writeFileSync(path.join(testFilesDir, "nomatch", "index.js"), "");
  fs.writeFileSync(path.join(testFilesDir, "nomatch", "index.js.map"), "");
  fs.writeFileSync(path.join(testFilesDir, "nomatch", "index.d.ts"), "");
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

  // Use printf instead of echo: fish's echo interprets -e/-n/-- as flags
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

  it.skipIf(!available)("filters file extension matches by filename prefix", () => {
    const values = complete(["deploy", "--config", "app"], { cwd: testFilesDir });
    expect(values).toContain("app.json");
    expect(values).toContain("app.yaml");
    // Non-matching prefix
    expect(values).not.toContain("deploy.yml");
  });

  it.skipIf(!available)("returns empty for non-existent directory path", () => {
    const values = complete(["deploy", "--config", "nonexistent/"], { cwd: testFilesDir });
    // No file candidates from a non-existent directory
    expect(values.filter((v) => v.startsWith("nonexistent/"))).toHaveLength(0);
  });

  it.skipIf(!available)("returns no file matches inside empty directory", () => {
    const values = complete(["deploy", "--config", "empty/"], { cwd: testFilesDir });
    // No files inside the empty directory
    expect(values.filter((v) => v.startsWith("empty/"))).toHaveLength(0);
  });

  it.skipIf(!available)(
    "does not show non-matching files in directory with no extension matches",
    () => {
      const values = complete(["deploy", "--config", "nomatch/"], { cwd: testFilesDir });
      // Directory has only .js, .js.map, .d.ts files — none match .json/.yaml/.yml
      expect(values).not.toContain("nomatch/index.js");
      expect(values).not.toContain("nomatch/index.js.map");
      expect(values).not.toContain("nomatch/index.d.ts");
    },
  );

  it.skipIf(!available)("completes options after boolean flag (no value consumed)", () => {
    const values = complete(["deploy", "--dry-run", "--"]);
    // --dry-run is boolean and should NOT consume the next word as its value
    expect(values).toContain("--env");
    expect(values).toContain("--config");
    // --dry-run itself should be filtered out (already used)
    expect(values).not.toContain("--dry-run");
  });

  it.skipIf(!available)("completes files inside subdirectory via trailing slash", () => {
    const values = complete(["deploy", "--config", "configs/"], { cwd: testFilesDir });
    expect(values).toContain("configs/prod.json");
    expect(values).toContain("configs/dev.yaml");
    // Non-matching extensions excluded
    expect(values).not.toContain("configs/notes.txt");
  });

  it.skipIf(!available)("completes option value after short alias", () => {
    const values = complete(["deploy", "-e", ""]);
    expect(values).toContain("development");
    expect(values).toContain("staging");
    expect(values).toContain("production");
  });

  it.skipIf(!available)("filters out option used via short alias", () => {
    const values = complete(["deploy", "-e", "staging", "--"]);
    expect(values).not.toContain("--env");
    expect(values).toContain("--config");
    expect(values).toContain("--dry-run");
  });

  it.skipIf(!available)("completes options after positional argument", () => {
    const values = complete(["test", "unit", "--"]);
    expect(values).toContain("--watch");
    expect(values).toContain("--help");
  });

  it.skipIf(!available)("completes file after multiple options", () => {
    const values = complete(["deploy", "--env", "staging", "--config", ""], {
      cwd: testFilesDir,
    });
    expect(values).toContain("app.json");
    expect(values).toContain("app.yaml");
    expect(values).toContain("deploy.yml");
  });

  // ─── Multiple positionals ──────────────────────────────────────────────────

  it.skipIf(!available)("completes first positional choices", () => {
    const values = complete(["migrate", ""]);
    expect(values).toContain("local");
    expect(values).toContain("staging");
    expect(values).toContain("production");
  });

  it.skipIf(!available)("completes second positional with different choices", () => {
    const values = complete(["migrate", "local", ""]);
    expect(values).toContain("dev");
    expect(values).toContain("qa");
    expect(values).toContain("prod");
    // First positional choices should NOT appear
    expect(values).not.toContain("local");
    expect(values).not.toContain("staging");
    expect(values).not.toContain("production");
  });

  it.skipIf(!available)("completes options after all positionals provided", () => {
    const values = complete(["migrate", "local", "dev", "--"]);
    expect(values).toContain("--dry-run");
    expect(values).toContain("--verbose");
    expect(values).toContain("--help");
  });

  // ─── Array (variadic) positional ───────────────────────────────────────────

  it.skipIf(!available)("completes array positional enum values", () => {
    const values = complete(["tag", ""]);
    expect(values).toContain("stable");
    expect(values).toContain("beta");
    expect(values).toContain("nightly");
    expect(values).toContain("rc");
  });

  it.skipIf(!available)("continues completing array positional after first value", () => {
    const values = complete(["tag", "stable", ""]);
    expect(values).toContain("stable");
    expect(values).toContain("beta");
    expect(values).toContain("nightly");
    expect(values).toContain("rc");
  });

  it.skipIf(!available)("completes options after array positional values", () => {
    const values = complete(["tag", "stable", "beta", "--"]);
    expect(values).toContain("--force");
    expect(values).toContain("--help");
  });

  // ─── Options interleaved with positionals ──────────────────────────────────

  it.skipIf(!available)(
    "completes positional after interleaved option (option before positional)",
    () => {
      const values = complete(["migrate", "--dry-run", "local", ""]);
      expect(values).toContain("dev");
      expect(values).toContain("qa");
      expect(values).toContain("prod");
      // First positional choices should not appear
      expect(values).not.toContain("local");
    },
  );

  it.skipIf(!available)(
    "completes positional after trailing boolean flag (positional before option)",
    () => {
      const values = complete(["migrate", "local", "--dry-run", ""]);
      expect(values).toContain("dev");
      expect(values).toContain("qa");
      expect(values).toContain("prod");
      // First positional choices should not appear
      expect(values).not.toContain("local");
      expect(values).not.toContain("staging");
      expect(values).not.toContain("production");
    },
  );

  it.skipIf(!available)("completes variadic positional after interleaved option", () => {
    const values = complete(["tag", "--force", "stable", ""]);
    expect(values).toContain("beta");
    expect(values).toContain("nightly");
    expect(values).toContain("rc");
  });

  // ─── Double-dash separator ─────────────────────────────────────────────────

  it.skipIf(!available)("does not show options after -- for command without positionals", () => {
    const values = complete(["deploy", "--"]);
    // "--" as current word (starts with -) → should show option completions
    expect(values).toContain("--env");
    // But after -- is consumed as separator, options must not appear
    const valuesAfter = complete(["deploy", "--", ""]);
    expect(valuesAfter).not.toContain("--env");
    expect(valuesAfter).not.toContain("--config");
    expect(valuesAfter).not.toContain("--dry-run");
  });

  it.skipIf(!available)("completes positional after -- separator", () => {
    const values = complete(["test", "--", ""]);
    expect(values).toContain("unit");
    expect(values).toContain("integration");
    expect(values).toContain("e2e");
  });

  it.skipIf(!available)("completes options after boolean flag in variadic command", () => {
    const values = complete(["tag", "--force", "--"]);
    expect(values).toContain("--help");
    // Should NOT show positional values
    expect(values).not.toContain("stable");
    expect(values).not.toContain("beta");
  });

  it.skipIf(!available)("completes options with short alias and file completion", () => {
    const values = complete(["deploy", "-e", "staging", "-c", ""], {
      cwd: testFilesDir,
    });
    expect(values).toContain("app.json");
    expect(values).toContain("app.yaml");
    expect(values).toContain("deploy.yml");
  });

  it.skipIf(!available)("shows options after inline = value", () => {
    const values = complete(["build", "--format=json", "--"]);
    expect(values).not.toContain("--format");
    expect(values).toContain("--output");
    expect(values).toContain("--minify");
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

  it("includes directories for file extension completion navigation", () => {
    const values = bashComplete(["deploy", "--config", ""], { cwd: testFilesDir });
    expect(values).toContain("configs");
    expect(values).toContain("scripts");
  });

  it("completes files inside subdirectory after directory selection", () => {
    const values = bashComplete(["deploy", "--config", "configs/"], { cwd: testFilesDir });
    expect(values).toContain("configs/prod.json");
    expect(values).toContain("configs/dev.yaml");
    expect(values).not.toContain("configs/notes.txt");
  });

  it("filters directory completion by prefix", () => {
    const values = bashComplete(["build", "--output", "con"], { cwd: testFilesDir });
    expect(values).toContain("configs");
    expect(values).not.toContain("scripts");
    expect(values).not.toContain("empty");
  });

  it("handles inline directory completion (--output=con)", () => {
    const values = bashComplete(["build", "--output=con"], { cwd: testFilesDir });
    expect(values).toContain("--output=configs");
    expect(values).not.toContain("--output=scripts");
    expect(values).not.toContain("--output=empty");
  });

  it("handles inline file extension completion (--config=app)", () => {
    const values = bashComplete(["deploy", "--config=app"], { cwd: testFilesDir });
    expect(values).toContain("--config=app.json");
    expect(values).toContain("--config=app.yaml");
    expect(values).not.toContain("--config=readme.md");
  });

  it("does not leak stale COMPREPLY across invocations", () => {
    // Call the completion function twice in the same bash session:
    // 1st: subcommand completion (returns build, deploy, etc.)
    // 2nd: extension-filtered file completion
    // The 2nd call should NOT contain subcommand entries from the 1st call
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
      env: testEnv,
      encoding: "utf-8",
      timeout: 15000,
      cwd: testFilesDir,
    });
    const values = result
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    // Should only have file-related completions, not subcommands from 1st call
    expect(values).not.toContain("build");
    expect(values).not.toContain("deploy");
    expect(values).toContain("app.json");
  });
});

// ─── Zsh-specific tests ──────────────────────────────────────────────────────

describe.skipIf(!hasZsh)("zsh-specific completion", () => {
  it("delegates to _files -/ for directory completion", () => {
    const values = zshComplete(["build", "--output", ""]);
    // Our _files stub returns __directive:directory__ for -/ flag
    expect(values).toContain("__directive:directory__");
  });

  it("uses _files -g for extension-filtered file completion", () => {
    const values = zshComplete(["deploy", "--config", ""], { cwd: testFilesDir });
    // _files -g stub lists matching files and directories
    expect(values).toContain("app.json");
    expect(values).toContain("app.yaml");
    expect(values).toContain("deploy.yml");
    expect(values).not.toContain("readme.md");
    expect(values).not.toContain("index.ts");
    // Directories for navigation
    expect(values).toContain("configs");
    expect(values).toContain("scripts");
  });

  it("completes files inside subdirectory", () => {
    const values = zshComplete(["deploy", "--config", "configs/"], { cwd: testFilesDir });
    expect(values).toContain("configs/prod.json");
    expect(values).toContain("configs/dev.yaml");
    expect(values).not.toContain("configs/notes.txt");
  });

  it("does not fall back to default file completion when no extensions match", () => {
    const values = zshComplete(["deploy", "--config", "nomatch/"], { cwd: testFilesDir });
    // nomatch/ has only .js, .js.map, .d.ts — none match .json/.yaml/.yml
    // return 0 should prevent zsh from falling back to default file completion
    expect(values).not.toContain("nomatch/index.js");
    expect(values).not.toContain("nomatch/index.js.map");
    expect(values).not.toContain("nomatch/index.d.ts");
  });
});

// ─── Fish-specific tests ─────────────────────────────────────────────────────

describe.skipIf(!hasFish)("fish-specific completion", () => {
  it("completes files inside subdirectory", () => {
    const values = fishComplete(["deploy", "--config", "configs/"], { cwd: testFilesDir });
    expect(values).toContain("configs/prod.json");
    expect(values).toContain("configs/dev.yaml");
    expect(values).not.toContain("configs/notes.txt");
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
   * Run zsh completion interactively via zpty and return the number of matches.
   *
   * Sets up a realistic completer chain (`_complete _files`) to simulate
   * real-world shell configuration where _files acts as a fallback completer.
   */
  function zshInteractiveComplete(args: string[], opts: { cwd: string }): number {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resultFile = path.join(tmpDir, `zpty-result-${ts}`);
    const setupFile = path.join(tmpDir, `zpty-setup-${ts}.zsh`);
    const mainFile = path.join(tmpDir, `zpty-main-${ts}.zsh`);
    const command = ["myapp", ...args].join(" ");

    // Setup script sourced inside the zpty interactive shell
    const setupContent = [
      `export TERM=dumb`,
      `export PATH="${tmpDir}:$PATH"`,
      `autoload -Uz compinit && compinit -u 2>/dev/null`,
      // Simulate common real-world completer chain with _files fallback
      `zstyle ':completion:*' completer _complete _files`,
      `eval "$(myapp completion zsh)" 2>/dev/null`,
      `comppostfuncs+=( _test_cap )`,
      `_test_cap() { echo $compstate[nmatches] > "${resultFile}" }`,
      `cd "${opts.cwd}"`,
    ].join("\n");
    fs.writeFileSync(setupFile, setupContent);

    // Main zpty driver script
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
    // nomatch/ has only .js, .js.map, .d.ts — none match .json/.yaml/.yml
    // Without file-patterns fix, _files -g falls back to *:all-files and shows 3 matches
    const nmatches = zshInteractiveComplete(["deploy", "--config", "nomatch/"], {
      cwd: testFilesDir,
    });
    expect(nmatches).toBe(0);
  }, 30000);

  it("shows matching files when extensions match", () => {
    // Root testFilesDir has app.json, app.yaml, deploy.yml + directories
    const nmatches = zshInteractiveComplete(["deploy", "--config", ""], {
      cwd: testFilesDir,
    });
    expect(nmatches).toBeGreaterThan(0);
  }, 30000);
});
