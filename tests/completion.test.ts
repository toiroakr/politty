import type * as childProcess from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  CompletionDirective,
  createCompletionCommand,
  createCompletionWorkerPathCommand,
  createDynamicCompleteCommand,
  defaultBundledWorkerOutputPath,
  extractCompletionData,
  formatForShell,
  generateBundledCompletionWorker,
  generateCandidates,
  generateCompletion,
  getSupportedShells,
  parseCompletionContext,
  validateBundledWorkerFile,
  withCompletionCommand,
} from "../src/completion/index.js";
import {
  hasManagedCache,
  install,
  installPath,
  refreshIfStale,
} from "../src/completion/install.js";
import { resolveBundledWorkerPath } from "../src/completion/bundled-worker.js";
import { defaultCacheDir, generateLoader } from "../src/completion/loader.js";
import {
  arg,
  defineCommand,
  isLazyCommand,
  lazy,
  runCommand,
  type CompletionMeta,
} from "../src/index.js";

// Spy on `spawn` so the runMainHook tests below can assert gating without
// actually spawning a child process. We must mock at module level — the
// hook calls the destructured `spawn` import inside src/completion/install.ts,
// so a `vi.spyOn` after the fact would not intercept it. Use `importOriginal`
// to keep every other child_process export intact (e.g. `execSync` which
// dynamic completion candidate generation depends on).
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof childProcess>()),
  spawn: vi.fn(() => ({ unref: () => {} })),
}));
const childProcessMock = await import("node:child_process");
const childProcessActual = await vi.importActual<typeof childProcess>("node:child_process");
const spawnSpy = vi.mocked(childProcessMock.spawn);

const useEnv = (env: Record<string, string | undefined>) => {
  const originalEnv = new Map(Object.keys(env).map((key) => [key, process.env[key]] as const));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return {
    [Symbol.dispose]() {
      for (const [key, value] of originalEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
};

const writeWorkerGeneratorCli = (root: string): string => {
  const bin = join(root, "mycli.mjs");
  writeFileSync(
    bin,
    [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'import { dirname } from "node:path";',
      "const [cmd, shell, out, ...flags] = process.argv.slice(2);",
      'if (cmd === "__refresh-completion") {',
      '  if (!out || !flags.includes("--static") || !flags.includes("--worker")) process.exit(2);',
      "  mkdirSync(dirname(out), { recursive: true });",
      "  writeFileSync(out, [",
      '    "# politty-completion-version: 1",',
      '    "# politty-bin-sig: 0",',
      '    `# program: ${process.env.PROGRAM_NAME ?? "mycli"}`,',
      "    `# shell: ${shell}`,",
      '    "# politty-completion-mode: worker",',
      '    "# politty-completion-worker: true",',
      '    "_mycli_worker_completions() { :; }",',
      '  ].join("\\n") + "\\n");',
      "  process.exit(0);",
      "}",
      'if (cmd === "__completion-worker-path") {',
      "  if (!process.env.WORKER_PATH) process.exit(1);",
      "  console.log(process.env.WORKER_PATH);",
      "  process.exit(0);",
      "}",
      "process.exit(1);",
    ].join("\n"),
  );
  return bin;
};

describe("Completion", () => {
  describe("extractCompletionData", () => {
    it("should extract options from a simple command", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Enable verbose output",
          }),
          output: arg(z.string(), {
            alias: "o",
            description: "Output file path",
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      expect(data.programName).toBe("test");
      expect(data.command.options).toHaveLength(2);

      const verboseOpt = data.command.options.find((o) => o.name === "verbose");
      expect(verboseOpt).toBeDefined();
      expect(verboseOpt?.alias).toEqual(["v"]);
      expect(verboseOpt?.description).toBe("Enable verbose output");
      expect(verboseOpt?.takesValue).toBe(false); // boolean flag

      const outputOpt = data.command.options.find((o) => o.name === "output");
      expect(outputOpt).toBeDefined();
      expect(outputOpt?.alias).toEqual(["o"]);
      expect(outputOpt?.takesValue).toBe(true); // string requires value
    });

    it("should expose visible alias but exclude hiddenAlias from extracted completion data", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          tobe: arg(z.string(), {
            alias: ["t", "to-be"],
            hiddenAlias: "legacy",
            description: "choice",
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");
      const opt = data.command.options.find((o) => o.name === "tobe");

      expect(opt).toBeDefined();
      // visible aliases only
      expect(opt?.alias).toEqual(["t", "to-be"]);
      // hiddenAlias must not leak into the completion alias list
      expect(opt?.alias).not.toContain("legacy");
    });

    it("should extract subcommands", () => {
      const buildCmd = defineCommand({
        name: "build",
        description: "Build the project",
        args: z.object({
          watch: arg(z.boolean().default(false), { alias: "w" }),
        }),
        run: () => {},
      });

      const testCmd = defineCommand({
        name: "test",
        description: "Run tests",
        run: () => {},
      });

      const mainCmd = defineCommand({
        name: "mycli",
        description: "My CLI tool",
        subCommands: {
          build: buildCmd,
          test: testCmd,
        },
      });

      const data = extractCompletionData(mainCmd, "mycli");

      expect(data.command.subcommands).toHaveLength(2);

      const buildSub = data.command.subcommands.find((s) => s.name === "build");
      expect(buildSub).toBeDefined();
      expect(buildSub?.description).toBe("Build the project");
      expect(buildSub?.options).toHaveLength(1);

      const testSub = data.command.subcommands.find((s) => s.name === "test");
      expect(testSub).toBeDefined();
      expect(testSub?.description).toBe("Run tests");
    });

    it("should handle nested subcommands", () => {
      const listCmd = defineCommand({
        name: "list",
        description: "List plugins",
        run: () => {},
      });

      const addCmd = defineCommand({
        name: "add",
        description: "Add a plugin",
        args: z.object({
          name: arg(z.string(), { positional: true }),
        }),
        run: () => {},
      });

      const pluginCmd = defineCommand({
        name: "plugin",
        description: "Plugin management",
        subCommands: {
          list: listCmd,
          add: addCmd,
        },
      });

      const mainCmd = defineCommand({
        name: "mycli",
        subCommands: {
          plugin: pluginCmd,
        },
      });

      const data = extractCompletionData(mainCmd, "mycli");

      const pluginSub = data.command.subcommands.find((s) => s.name === "plugin");
      expect(pluginSub).toBeDefined();
      expect(pluginSub?.subcommands).toHaveLength(2);
    });

    it("should not include positional arguments as options", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          file: arg(z.string(), { positional: true, description: "File path" }),
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      // Only verbose should be in options (file is positional)
      expect(data.command.options).toHaveLength(1);
      expect(data.command.options[0]?.name).toBe("verbose");
    });

    it("should extract enum values from z.enum schema", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          format: arg(z.enum(["json", "yaml", "xml"]), {
            alias: "f",
            description: "Output format",
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      const formatOpt = data.command.options.find((o) => o.name === "format");
      expect(formatOpt).toBeDefined();
      expect(formatOpt?.valueCompletion).toBeDefined();
      expect(formatOpt?.valueCompletion?.type).toBe("choices");
      expect(formatOpt?.valueCompletion?.choices).toEqual(["json", "yaml", "xml"]);
    });

    it("should use explicit custom completion over enum detection", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          format: arg(z.enum(["json", "yaml"]), {
            alias: "f",
            completion: {
              custom: { choices: ["custom1", "custom2"] },
            },
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      const formatOpt = data.command.options.find((o) => o.name === "format");
      expect(formatOpt?.valueCompletion?.type).toBe("choices");
      expect(formatOpt?.valueCompletion?.choices).toEqual(["custom1", "custom2"]);
    });

    it("should extract file completion metadata", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          config: arg(z.string(), {
            alias: "c",
            completion: { type: "file", extensions: ["json", "yaml"] },
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      const configOpt = data.command.options.find((o) => o.name === "config");
      expect(configOpt?.valueCompletion).toBeDefined();
      expect(configOpt?.valueCompletion?.type).toBe("file");
      expect(configOpt?.valueCompletion?.extensions).toEqual(["json", "yaml"]);
    });

    it("should extract file completion metadata with matcher", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          envFile: arg(z.string(), {
            completion: { type: "file", matcher: [".env.*"] },
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      const envFileOpt = data.command.options.find((o) => o.name === "envFile");
      expect(envFileOpt?.valueCompletion).toBeDefined();
      expect(envFileOpt?.valueCompletion?.type).toBe("file");
      expect(envFileOpt?.valueCompletion?.matcher).toEqual([".env.*"]);
      expect(envFileOpt?.valueCompletion?.extensions).toBeUndefined();
    });

    it("should extract directory completion metadata", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          outputDir: arg(z.string(), {
            alias: "o",
            completion: { type: "directory" },
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      const outputDirOpt = data.command.options.find((o) => o.name === "outputDir");
      expect(outputDirOpt?.valueCompletion?.type).toBe("directory");
    });

    it("should extract shell command completion metadata", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          branch: arg(z.string().optional(), {
            alias: "b",
            completion: {
              custom: { shellCommand: "git branch --format='%(refname:short)'" },
            },
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      const branchOpt = data.command.options.find((o) => o.name === "branch");
      expect(branchOpt?.valueCompletion?.type).toBe("command");
      expect(branchOpt?.valueCompletion?.shellCommand).toBe(
        "git branch --format='%(refname:short)'",
      );
    });

    it("should extract positional arguments with completion", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          input: arg(z.string(), {
            positional: true,
            description: "Input file",
            completion: { type: "file", extensions: ["txt", "md"] },
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      expect(data.command.positionals).toHaveLength(1);
      const inputPos = data.command.positionals[0];
      expect(inputPos?.name).toBe("input");
      expect(inputPos?.valueCompletion?.type).toBe("file");
      expect(inputPos?.valueCompletion?.extensions).toEqual(["txt", "md"]);
    });

    it("should handle positional with enum completion", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          action: arg(z.enum(["start", "stop", "restart"]), {
            positional: true,
            description: "Action to perform",
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      expect(data.command.positionals).toHaveLength(1);
      const actionPos = data.command.positionals[0];
      expect(actionPos?.valueCompletion?.type).toBe("choices");
      expect(actionPos?.valueCompletion?.choices).toEqual(["start", "stop", "restart"]);
    });

    it("should extract full metadata from lazy() subcommands", () => {
      const lazyCmd = lazy(
        defineCommand({
          name: "deploy",
          description: "Deploy the application",
          args: z.object({
            env: arg(z.enum(["dev", "staging", "prod"]), {
              description: "Target environment",
            }),
          }),
        }),
        async () => defineCommand({ name: "deploy", run: () => {} }),
      );

      const cmd = defineCommand({
        name: "mycli",
        subCommands: { deploy: lazyCmd },
      });

      const data = extractCompletionData(cmd, "mycli");

      expect(data.command.subcommands).toHaveLength(1);
      const deploySub = data.command.subcommands[0];
      expect(deploySub?.name).toBe("deploy");
      expect(deploySub?.description).toBe("Deploy the application");
      expect(deploySub?.options).toHaveLength(1);
      expect(deploySub?.options[0]?.name).toBe("env");
      expect(deploySub?.options[0]?.valueCompletion?.type).toBe("choices");
      expect(deploySub?.options[0]?.valueCompletion?.choices).toEqual(["dev", "staging", "prod"]);
    });

    it("should still produce placeholder for legacy async subcommands", () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: {
          legacy: async () => defineCommand({ name: "legacy", description: "Legacy command" }),
        },
      });

      const data = extractCompletionData(cmd, "mycli");

      expect(data.command.subcommands).toHaveLength(1);
      const legacySub = data.command.subcommands[0];
      expect(legacySub?.name).toBe("legacy");
      expect(legacySub?.description).toBe("(lazy loaded)");
      expect(legacySub?.options).toHaveLength(0);
    });
  });

  describe("generateCompletion", () => {
    const testCommand = defineCommand({
      name: "mycli",
      description: "My CLI tool",
      args: z.object({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Verbose output",
        }),
        config: arg(z.string().optional(), {
          alias: "c",
          description: "Config file path",
        }),
      }),
      subCommands: {
        build: defineCommand({
          name: "build",
          description: "Build the project",
          args: z.object({
            watch: arg(z.boolean().default(false), {
              alias: "w",
              description: "Watch mode",
            }),
          }),
          run: () => {},
        }),
        test: defineCommand({
          name: "test",
          description: "Run tests",
          run: () => {},
        }),
      },
    });

    describe("bash completion", () => {
      it("should generate valid bash completion script", () => {
        const result = generateCompletion(testCommand, {
          shell: "bash",
          programName: "mycli",
        });

        expect(result.shell).toBe("bash");
        expect(result.script).toContain("# politty-completion-version: 1");
        expect(result.script).toContain("# program: mycli");
        expect(result.script).toContain("# shell: bash");
        expect(result.script).toContain("_mycli_completions()");
        expect(result.script).toContain("complete -o default -F _mycli_completions mycli");
      });

      it("should include installation instructions", () => {
        const result = generateCompletion(testCommand, {
          shell: "bash",
          programName: "mycli",
        });

        expect(result.installInstructions).toContain("~/.bashrc");
        expect(result.installInstructions).toContain('eval "$(mycli completion bash)"');
        expect(result.installInstructions).toContain("mycli completion bash >");
        expect(result.installInstructions).not.toContain("mycli completion bash --loader");
      });

      it("should not contain __command or __extensions handling", () => {
        const result = generateCompletion(testCommand, {
          shell: "bash",
          programName: "mycli",
        });

        expect(result.script).not.toContain("__command:");
        expect(result.script).not.toContain("__extensions:");
        expect(result.script).not.toContain("command_completion");
      });
    });

    describe("zsh completion", () => {
      it("should generate valid zsh completion script", () => {
        const result = generateCompletion(testCommand, {
          shell: "zsh",
          programName: "mycli",
        });

        expect(result.shell).toBe("zsh");
        expect(result.script).toContain("#compdef mycli");
        expect(result.script).toContain("# politty-completion-version: 1");
        expect(result.script).toContain("# program: mycli");
        expect(result.script).toContain("# shell: zsh");
        expect(result.script).toContain("_mycli()");
        expect(result.script).toContain("compdef _mycli mycli");
        expect(result.script).toContain('if [[ "${funcstack[1]:-}" == "_mycli" ]]; then');
        expect(result.script).toContain('_mycli "$@"');
      });

      it("should include backwards-compatible fpath installation instructions", () => {
        const result = generateCompletion(testCommand, {
          shell: "zsh",
          programName: "mycli",
        });

        expect(result.installInstructions).toContain('eval "$(mycli completion zsh)"');
        expect(result.installInstructions).toContain("after compinit");
        expect(result.installInstructions).toContain("mycli completion zsh >");
        expect(result.installInstructions).toContain("fpath line before compinit");
        expect(result.installInstructions).toContain("fpath=(~/.zsh/completions $fpath)");
        expect(result.installInstructions).toContain("~/.zsh/completions/_mycli");
        expect(result.installInstructions).not.toContain("mycli completion zsh --install");
      });

      it("uses the command name as the zsh fpath entrypoint", () => {
        const result = generateCompletion(testCommand, {
          shell: "zsh",
          programName: "tailor-sdk",
        });

        expect(result.script).toContain("_tailor-sdk()");
        expect(result.script).not.toContain("\n_tailor_sdk() {");
        expect(result.script).toContain('if [[ "${funcstack[1]:-}" == "_tailor-sdk" ]]; then');
        expect(result.script).toContain('_tailor-sdk "$@"');
        expect(result.script).toContain("compdef _tailor-sdk tailor-sdk");
        expect(result.installInstructions).toContain("~/.zsh/completions/_tailor-sdk");
        expect(result.installInstructions).not.toContain("~/.zsh/completions/_tailor_sdk");
      });
    });

    describe("fish completion", () => {
      it("should generate valid fish completion script", () => {
        const result = generateCompletion(testCommand, {
          shell: "fish",
          programName: "mycli",
        });

        expect(result.shell).toBe("fish");
        expect(result.script).toContain("# politty-completion-version: 1");
        expect(result.script).toContain("# program: mycli");
        expect(result.script).toContain("# shell: fish");
        expect(result.script).toContain("complete -c mycli");
        expect(result.script).toContain("__fish_mycli_complete");
        expect(result.script).toContain("complete -c mycli -f");
      });

      it("should include install instructions", () => {
        const result = generateCompletion(testCommand, {
          shell: "fish",
          programName: "mycli",
        });

        expect(result.installInstructions).toContain("mycli completion fish --install");
        expect(result.installInstructions).not.toMatch(/^mycli completion fish \| source/m);
        expect(result.installInstructions).not.toMatch(/^mycli completion fish >/m);
      });
    });

    describe("dispatcher mode", () => {
      const dispatcherCommand = defineCommand({
        name: "mycli",
        args: z.object({
          verbose: arg(z.boolean().default(false), {
            description: "Verbose output",
          }),
        }),
        subCommands: {
          build: defineCommand({
            name: "build",
            description: "Build the project",
            run: () => {},
          }),
        },
      });

      it("emits dispatcher completion for every shell in dispatcher mode", () => {
        const cases = [
          ["bash", "type -P 'mycli'"],
          ["zsh", "whence -p 'mycli'"],
          ["fish", "command -v 'mycli'"],
        ] as const;

        for (const [shell, resolver] of cases) {
          const { script } = generateCompletion(dispatcherCommand, {
            shell,
            programName: "mycli",
            mode: "dispatcher",
          });

          expect(script).toContain("# politty-completion-mode: dispatcher");
          expect(script).toContain(resolver);
          expect(script).toContain("MYCLI_BIN");
          expect(script).toContain("NODE_COMPILE_CACHE");
          expect(script).toContain("__refresh-completion");
          expect(script).toContain("--static --worker");
          expect(script).toContain("__complete --shell");
          expect(script).not.toContain("--verbose");
          expect(script).not.toContain("Build the project");
        }
      });

      it("defaults to a self-contained static script for the direct generateCompletion API", () => {
        const { script } = generateCompletion(dispatcherCommand, {
          shell: "bash",
          programName: "mycli",
        });

        expect(script).toContain("# politty-completion-mode: static");
        expect(script).not.toContain("# politty-completion-mode: dispatcher");
        // Static scripts bake the command metadata directly into the body.
        expect(script).toContain("--verbose");
        expect(script).toContain("build");
      });

      it("suppresses bash file fallback for empty NoFileCompletion results (bash 3.2)", () => {
        const { script } = generateCompletion(dispatcherCommand, {
          shell: "bash",
          programName: "mycli",
          mode: "dispatcher",
        });

        // bash 3.2 ignores `compopt +o default`, so an empty COMPREPLY in the
        // NoFileCompletion branch must be seeded with the empty sentinel to stop
        // `complete -o default` from falling through to filenames.
        expect(script).toMatch(
          /elif \(\( _directive & 2 \)\); then[\s\S]*?if \(\( \$\{#COMPREPLY\[@\]\} == 0 \)\); then COMPREPLY=\( "" \); fi/,
        );
        // Same fallback guard for the extension/matcher branch: when no file
        // matched the filter, do not leak unrelated files on bash 3.2.
        expect(script).toMatch(
          /done < <\(compgen -f -- "\$_cur"\)\s*\n\s*if \(\( \$\{#COMPREPLY\[@\]\} == 0 \)\); then COMPREPLY=\( "" \); fi/,
        );
      });

      it("validates bundled worker headers by whole line, not substring", () => {
        // A worker built for another program (e.g. `mycli-extra`) or a future
        // version must not be accepted by `mycli`; the runtime check anchors each
        // header to a complete line, mirroring validateBundledWorkerFile.
        for (const shell of ["bash", "zsh"] as const) {
          const { script } = generateCompletion(dispatcherCommand, {
            shell,
            programName: "mycli",
            mode: "dispatcher",
          });
          expect(script).toContain(`*$'\\n'"# program: mycli"$'\\n'*`);
          expect(script).toContain(`*$'\\n'"# politty-completion-version: 1"$'\\n'*`);
          expect(script).not.toContain(`*"# program: mycli"*`);
        }

        const { script: fish } = generateCompletion(dispatcherCommand, {
          shell: "fish",
          programName: "mycli",
          mode: "dispatcher",
        });
        expect(fish).toContain(`string match -q -- "# program: mycli" $_head`);
        expect(fish).not.toContain(`'*# program: mycli*'`);
      });

      it("passes NODE_COMPILE_CACHE to the warm worker path", () => {
        // The worker's dynamic resolver may spawn `__complete`; it must inherit
        // the compile cache the direct fallback already sets, or repeated TABs
        // lose the latency win on the warm path.
        const bash = generateCompletion(dispatcherCommand, {
          shell: "bash",
          programName: "mycli",
          mode: "dispatcher",
        }).script;
        expect(bash).toContain(
          `NODE_COMPILE_CACHE="$_node_compile_cache" MYCLI_WORKER_BIN="$_bin" _mycli_worker_completions`,
        );

        const zsh = generateCompletion(dispatcherCommand, {
          shell: "zsh",
          programName: "mycli",
          mode: "dispatcher",
        }).script;
        expect(zsh).toContain(
          `NODE_COMPILE_CACHE="$_node_compile_cache" MYCLI_WORKER_BIN="$_bin" _mycli_worker_completions "$@"`,
        );

        const fish = generateCompletion(dispatcherCommand, {
          shell: "fish",
          programName: "mycli",
          mode: "dispatcher",
        }).script;
        expect(fish).toContain(`set -lx NODE_COMPILE_CACHE "$_node_compile_cache"`);
      });

      it("loads the static worker only when its sig matches (failed refresh falls back)", () => {
        // A failed refresh leaves a stale worker on disk; the load is gated on
        // the worker's `# politty-bin-sig` matching the current binary so the
        // dispatcher falls through to `__complete` rather than serving outdated
        // completions.
        const bash = generateCompletion(dispatcherCommand, {
          shell: "bash",
          programName: "mycli",
          mode: "dispatcher",
        }).script;
        expect(bash).toContain(
          'grep -qF "# politty-bin-sig: $_sig" && __mycli_load_worker "$_worker"',
        );

        const zsh = generateCompletion(dispatcherCommand, {
          shell: "zsh",
          programName: "mycli",
          mode: "dispatcher",
        }).script;
        expect(zsh).toContain(
          'grep -qF "# politty-bin-sig: $_sig" && __mycli_load_worker "$_worker"',
        );

        const fish = generateCompletion(dispatcherCommand, {
          shell: "fish",
          programName: "mycli",
          mode: "dispatcher",
        }).script;
        expect(fish).toContain(
          'test -f "$_worker"; and head -n 10 "$_worker" 2>/dev/null | grep -qF "# politty-bin-sig: $_sig"',
        );
      });

      it("guards bash command substitutions so a miss does not abort under set -e", () => {
        const { script } = generateCompletion(dispatcherCommand, {
          shell: "bash",
          programName: "mycli",
          mode: "dispatcher",
        });

        // Expected helper misses (e.g. no bundled worker) must not abort the
        // completion function when the user has `set -e` enabled.
        expect(script).toContain(`|| _bundled_worker=""`);
        expect(script).toContain(`|| _worker=""`);
        expect(script).toContain(`|| _sig=""`);
      });

      it("does not split inline option prefixes after a -- separator in bash", () => {
        const { script } = generateCompletion(dispatcherCommand, {
          shell: "bash",
          programName: "mycli",
          mode: "dispatcher",
        });

        // A word like `-D=foo` after `--` is a positional, not an inline option
        // value, so the inline split must be gated on not being after `--`.
        expect(script).toContain(`local _after_dd=0`);
        expect(script).toContain(`if (( ! _after_dd )) && [[ "$_cur" == -*=* ]]; then`);
      });

      it("keeps static mode available with baked command metadata", () => {
        const { script } = generateCompletion(dispatcherCommand, {
          shell: "bash",
          programName: "mycli",
          mode: "static",
        });

        expect(script).toContain("# politty-completion-mode: static");
        expect(script).toContain("--verbose");
        expect(script).toContain("build");
      });

      it("can generate an internal static worker without shell registration", () => {
        const { script } = generateCompletion(dispatcherCommand, {
          shell: "bash",
          programName: "mycli",
          mode: "static",
          staticWorker: { functionSuffix: "worker" },
        });

        expect(script).toContain("# politty-completion-worker: true");
        expect(script).toContain("# politty-completion-mode: worker");
        expect(script).toContain("_mycli_worker_completions()");
        expect(script).toContain("--verbose");
        expect(script).toContain("build");
        expect(script).not.toContain("complete -o default -F");
        expect(script).not.toContain("__mycli_self_refresh()");
      });

      it("uses the PATH-visible executable and lets MYCLI_BIN override it in bash", () => {
        const root = mkdtempSync(join(tmpdir(), "politty-dispatcher-"));
        const localDir = join(root, "local");
        const globalDir = join(root, "global");
        mkdirSync(localDir);
        mkdirSync(globalDir);
        const localBin = join(localDir, "mycli");
        const globalBin = join(globalDir, "mycli");
        const writeFake = (file: string, label: string) => {
          writeFileSync(
            file,
            `#!/bin/sh\nif [ "$1" = "__complete" ]; then printf '%s\\n:6\\n' '${label}'; fi\n`,
            { mode: 0o755 },
          );
        };
        writeFake(localBin, "local-candidate");
        writeFake(globalBin, "global-candidate");

        const completionPath = join(root, "completion.bash");
        writeFileSync(
          completionPath,
          generateCompletion(dispatcherCommand, {
            shell: "bash",
            programName: "mycli",
            mode: "dispatcher",
          }).script,
        );
        const runner = join(root, "run.sh");
        writeFileSync(
          runner,
          [
            `source '${completionPath}'`,
            `COMP_WORDS=('mycli' '')`,
            `COMP_CWORD=1`,
            `COMP_LINE='mycli '`,
            `COMP_POINT=\${#COMP_LINE}`,
            `_mycli_completions`,
            `printf '%s\\n' "\${COMPREPLY[@]}"`,
          ].join("\n"),
        );

        const baseEnv = {
          ...process.env,
          BASH_ENV: "/dev/null",
          PATH: `${localDir}:${globalDir}:${process.env.PATH}`,
        };
        const fromPath = childProcessActual.execFileSync(
          "/bin/bash",
          ["--noprofile", "--norc", runner],
          { env: baseEnv, encoding: "utf8", timeout: 1000 },
        );
        expect(fromPath.trim()).toBe("local-candidate");

        const fromOverride = childProcessActual.execFileSync(
          "/bin/bash",
          ["--noprofile", "--norc", runner],
          { env: { ...baseEnv, MYCLI_BIN: globalBin }, encoding: "utf8", timeout: 1000 },
        );
        expect(fromOverride.trim()).toBe("global-candidate");
      });

      it("uses a bundled worker before cache refresh and memoizes sourcing in bash", () => {
        const root = mkdtempSync(join(tmpdir(), "politty-bundled-worker-"));
        const distDir = join(root, "pkg", "dist");
        const completionDir = join(distDir, "completion");
        const binDir = join(root, "bin");
        mkdirSync(completionDir, { recursive: true });
        mkdirSync(binDir);

        const callLog = join(root, "bin-calls.log");
        const sourceLog = join(root, "worker-sources.log");
        const bin = join(distDir, "mycli");
        writeFileSync(
          bin,
          [
            "#!/bin/sh",
            `printf '%s\\n' "$1" >> "$CALL_LOG"`,
            `if [ "$1" = "__complete" ]; then printf '%s\\n:6\\n' dynamic-candidate; fi`,
          ].join("\n"),
          { mode: 0o755 },
        );
        writeFileSync(
          join(binDir, "mycli"),
          `#!/bin/sh\nexec '${bin}' "$@"\n# cmd-shim-target=${bin}\n`,
          {
            mode: 0o755,
          },
        );

        writeFileSync(
          join(completionDir, "bash-worker.bash"),
          [
            "# politty-completion-version: 1",
            "# politty-bin-sig: 0",
            "# program: mycli",
            "# shell: bash",
            "# politty-completion-mode: worker",
            "# politty-completion-worker: true",
            `printf '%s\\n' sourced >> "$SOURCE_LOG"`,
            `_mycli_worker_completions() { COMPREPLY=(bundled-candidate); }`,
          ].join("\n"),
        );

        const completionPath = join(root, "completion.bash");
        writeFileSync(
          completionPath,
          generateCompletion(dispatcherCommand, {
            shell: "bash",
            programName: "mycli",
            mode: "dispatcher",
          }).script,
        );
        const runner = join(root, "run.sh");
        writeFileSync(
          runner,
          [
            `source '${completionPath}'`,
            `for _n in 1 2; do`,
            `  COMP_WORDS=('mycli' '')`,
            `  COMP_CWORD=1`,
            `  COMP_LINE='mycli '`,
            `  COMP_POINT=\${#COMP_LINE}`,
            `  COMPREPLY=()`,
            `  _mycli_completions`,
            `  printf 'reply:%s\\n' "\${COMPREPLY[0]}"`,
            `done`,
            `if [ -f "$SOURCE_LOG" ]; then printf 'sources:%s\\n' "$(wc -l < "$SOURCE_LOG" | tr -d ' ')"; else printf 'sources:0\\n'; fi`,
            `if [ -f "$CALL_LOG" ]; then printf 'calls:%s\\n' "$(wc -l < "$CALL_LOG" | tr -d ' ')"; else printf 'calls:0\\n'; fi`,
          ].join("\n"),
        );

        const output = childProcessActual.execFileSync(
          "/bin/bash",
          ["--noprofile", "--norc", runner],
          {
            env: {
              ...process.env,
              BASH_ENV: "/dev/null",
              CALL_LOG: callLog,
              PATH: `${binDir}:${process.env.PATH}`,
              SOURCE_LOG: sourceLog,
            },
            encoding: "utf8",
            timeout: 1000,
          },
        );

        expect(output.trim().split("\n")).toEqual([
          "reply:bundled-candidate",
          "reply:bundled-candidate",
          "sources:1",
          "calls:0",
        ]);
      });

      it("uses __completion-worker-path before cache refresh when relative lookup misses in bash", () => {
        const root = mkdtempSync(join(tmpdir(), "politty-worker-path-fallback-"));
        const workerDir = join(root, "workers");
        const binDir = join(root, "bin");
        mkdirSync(workerDir);
        mkdirSync(binDir);

        const callLog = join(root, "bin-calls.log");
        const workerPath = join(workerDir, "custom-worker.bash");
        const bin = join(binDir, "mycli");
        writeFileSync(
          bin,
          [
            "#!/bin/sh",
            `printf '%s\\n' "$1" >> "$CALL_LOG"`,
            `case "$1" in`,
            `  __completion-worker-path) printf '%s\\n' "$WORKER_PATH"; exit 0 ;;`,
            `  __refresh-completion) exit 1 ;;`,
            `  __complete) printf '%s\\n:6\\n' dynamic-candidate; exit 0 ;;`,
            `esac`,
          ].join("\n"),
          { mode: 0o755 },
        );

        writeFileSync(
          workerPath,
          [
            "# politty-completion-version: 1",
            "# politty-bin-sig: 0",
            "# program: mycli",
            "# shell: bash",
            "# politty-completion-mode: worker",
            "# politty-completion-worker: true",
            `_mycli_worker_completions() { COMPREPLY=(path-command-candidate); }`,
          ].join("\n"),
        );

        const completionPath = join(root, "completion.bash");
        writeFileSync(
          completionPath,
          generateCompletion(dispatcherCommand, {
            shell: "bash",
            programName: "mycli",
            mode: "dispatcher",
            bundledWorker: { queryCommand: true, relativePaths: { bash: ["missing-worker.bash"] } },
          }).script,
        );
        const runner = join(root, "run.sh");
        writeFileSync(
          runner,
          [
            `source '${completionPath}'`,
            `COMP_WORDS=('mycli' '')`,
            `COMP_CWORD=1`,
            `COMP_LINE='mycli '`,
            `COMP_POINT=\${#COMP_LINE}`,
            `_mycli_completions`,
            `printf 'reply:%s\\n' "\${COMPREPLY[0]}"`,
          ].join("\n"),
        );

        const output = childProcessActual.execFileSync(
          "/bin/bash",
          ["--noprofile", "--norc", runner],
          {
            env: {
              ...process.env,
              BASH_ENV: "/dev/null",
              CALL_LOG: callLog,
              PATH: `${binDir}:${process.env.PATH}`,
              WORKER_PATH: workerPath,
            },
            encoding: "utf8",
            timeout: 1000,
          },
        );

        expect(output.trim()).toBe("reply:path-command-candidate");
        expect(readFileSync(callLog, "utf8").trim().split("\n")).toEqual([
          "__completion-worker-path",
        ]);
      });

      it("does not query __completion-worker-path by default", () => {
        const { script } = generateCompletion(dispatcherCommand, {
          shell: "bash",
          programName: "mycli",
        });

        expect(script).not.toContain("__completion-worker-path");
      });

      it("disables bundled worker lookup without leaving sentinel paths", () => {
        const { script } = generateCompletion(dispatcherCommand, {
          shell: "bash",
          programName: "mycli",
          bundledWorker: { disabled: true },
        });

        expect(script).not.toContain("__completion-worker-path");
        expect(script).not.toContain("bash-worker.bash");
        expect(script).not.toContain("__politty_no_bundled_worker__");
      });

      it("generates and verifies a bundled worker through the helper", async () => {
        const root = mkdtempSync(join(tmpdir(), "politty-generate-worker-"));
        const bin = writeWorkerGeneratorCli(root);
        const outputPath = join(root, "dist", "completion", "zsh-worker.zsh");

        const result = await generateBundledCompletionWorker({
          bin,
          programName: "mycli",
          shell: "zsh",
          outputPath,
          verify: true,
          quiet: true,
          env: { WORKER_PATH: outputPath },
        });

        expect(result).toEqual({
          outputPath,
          reportedPath: outputPath,
          size: statSync(outputPath).size,
        });
        validateBundledWorkerFile(outputPath, "mycli", "zsh");
      });

      it("uses the default bundled worker output path", async () => {
        const root = mkdtempSync(join(tmpdir(), "politty-default-worker-path-"));
        const bin = writeWorkerGeneratorCli(root);
        const outputPath = join(root, defaultBundledWorkerOutputPath("fish"));

        const result = await generateBundledCompletionWorker({
          bin,
          programName: "mycli",
          shell: "fish",
          cwd: root,
          verify: false,
          quiet: true,
        });

        expect(result.outputPath).toBe(outputPath);
        validateBundledWorkerFile(outputPath, "mycli", "fish");
      });

      it("fails verification when the reported bundled worker path differs", async () => {
        const root = mkdtempSync(join(tmpdir(), "politty-worker-path-mismatch-"));
        const bin = writeWorkerGeneratorCli(root);
        const outputPath = join(root, "dist", "completion", "zsh-worker.zsh");
        const otherPath = join(root, "dist", "completion", "other.zsh");
        mkdirSync(dirname(otherPath), { recursive: true });
        writeFileSync(otherPath, "other\n");

        await expect(
          generateBundledCompletionWorker({
            bin,
            programName: "mycli",
            shell: "zsh",
            outputPath,
            verify: true,
            quiet: true,
            env: { WORKER_PATH: otherPath },
          }),
        ).rejects.toThrow(/path mismatch/);
      });

      it("forces a fresh bundled worker even when an existing artifact would be skipped", async () => {
        const root = mkdtempSync(join(tmpdir(), "politty-worker-force-"));
        // Fake CLI whose __refresh-completion mimics the real sig-match no-op:
        // it only writes when the target is absent. With a stale file present,
        // a non-forcing generator would return the stale artifact unchanged.
        const bin = join(root, "mycli.mjs");
        writeFileSync(
          bin,
          [
            'import { existsSync, mkdirSync, writeFileSync } from "node:fs";',
            'import { dirname } from "node:path";',
            "const [cmd, shell, out] = process.argv.slice(2);",
            'if (cmd === "__refresh-completion") {',
            "  if (existsSync(out)) process.exit(0);",
            "  mkdirSync(dirname(out), { recursive: true });",
            "  writeFileSync(out, [",
            '    "# politty-completion-version: 1",',
            '    "# politty-completion-mode: worker",',
            '    "# politty-completion-worker: true",',
            '    "# program: mycli",',
            "    `# shell: ${shell}`,",
            '    "# FRESH",',
            '  ].join("\\n") + "\\n");',
            "  process.exit(0);",
            "}",
            "process.exit(1);",
          ].join("\n"),
        );

        const outputPath = join(root, "dist", "completion", "zsh-worker.zsh");
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(
          outputPath,
          `${[
            "# politty-completion-version: 1",
            "# politty-completion-mode: worker",
            "# politty-completion-worker: true",
            "# program: mycli",
            "# shell: zsh",
            "# STALE",
          ].join("\n")}\n`,
        );

        await generateBundledCompletionWorker({
          bin,
          programName: "mycli",
          shell: "zsh",
          outputPath,
          verify: false,
          quiet: true,
        });

        const regenerated = readFileSync(outputPath, "utf8");
        expect(regenerated).toContain("# FRESH");
        expect(regenerated).not.toContain("# STALE");
      });

      it("prefers the current executable over a same-named binary earlier on PATH", () => {
        const rel = defaultBundledWorkerOutputPath("zsh");
        const workerContent = `${[
          "# politty-completion-version: 1",
          "# politty-completion-mode: worker",
          "# politty-completion-worker: true",
          "# program: mycli",
          "# shell: zsh",
        ].join("\n")}\n`;
        const root = mkdtempSync(join(tmpdir(), "politty-worker-precedence-"));

        // Decoy install earlier on PATH, with its own valid worker.
        const decoyDir = join(root, "decoy");
        const decoyWorker = join(decoyDir, rel);
        mkdirSync(dirname(decoyWorker), { recursive: true });
        writeFileSync(join(decoyDir, "mycli"), "#!/bin/sh\n", { mode: 0o755 });
        writeFileSync(decoyWorker, workerContent);

        // The install actually being executed (process.argv[1]).
        const realDir = join(root, "real");
        const realWorker = join(realDir, rel);
        mkdirSync(dirname(realWorker), { recursive: true });
        const realBin = join(realDir, "mycli");
        writeFileSync(realBin, "#!/bin/sh\n", { mode: 0o755 });
        writeFileSync(realWorker, workerContent);

        const prevArgv1 = process.argv[1] ?? "";
        const prevPath = process.env.PATH;
        process.argv[1] = realBin;
        process.env.PATH = `${decoyDir}${delimiter}${prevPath ?? ""}`;
        try {
          // No explicit binPath: worker discovery must prefer the current
          // executable (argv[1]) over the PATH-resolved decoy install's worker.
          const resolved = resolveBundledWorkerPath({ programName: "mycli", shell: "zsh" });
          expect(resolved).not.toBeNull();
          expect(realpathSync(resolved!)).toBe(realpathSync(realWorker));
          expect(realpathSync(resolved!)).not.toBe(realpathSync(decoyWorker));
        } finally {
          process.argv[1] = prevArgv1;
          process.env.PATH = prevPath;
        }
      });

      it("rejects bundled worker files missing required worker metadata", () => {
        const root = mkdtempSync(join(tmpdir(), "politty-invalid-worker-"));
        const workerPath = join(root, "zsh-worker.zsh");
        writeFileSync(
          workerPath,
          [
            "# politty-completion-version: 1",
            "# program: mycli",
            "# shell: zsh",
            "# politty-completion-worker: true",
          ].join("\n"),
        );

        expect(() => validateBundledWorkerFile(workerPath, "mycli", "zsh")).toThrow(
          /politty-completion-mode/,
        );
      });

      it("rejects a bundled worker whose program header only matches as a substring", () => {
        const root = mkdtempSync(join(tmpdir(), "politty-worker-substring-"));
        const workerPath = join(root, "zsh-worker.zsh");
        writeFileSync(
          workerPath,
          [
            "# politty-completion-version: 1",
            "# politty-completion-mode: worker",
            "# politty-completion-worker: true",
            "# program: mycli-extra",
            "# shell: zsh",
          ].join("\n"),
        );

        // `mycli` must not accept a worker built for `mycli-extra`, even though
        // "# program: mycli" is a substring of the "# program: mycli-extra" line.
        expect(() => validateBundledWorkerFile(workerPath, "mycli", "zsh")).toThrow(
          /# program: mycli/,
        );
      });

      it("sets a default Node compile cache for bash and preserves user overrides", () => {
        const root = mkdtempSync(join(tmpdir(), "politty-dispatcher-cache-"));
        const binDir = join(root, "bin");
        const xdgCache = join(root, "xdg-cache");
        const home = join(root, "home");
        mkdirSync(binDir);
        mkdirSync(xdgCache);
        mkdirSync(home);

        const bin = join(binDir, "mycli");
        writeFileSync(
          bin,
          [
            "#!/bin/sh",
            `if [ "$1" = "__complete" ]; then`,
            `  printf '%s\\n:6\\n' "$NODE_COMPILE_CACHE"`,
            "fi",
          ].join("\n"),
          { mode: 0o755 },
        );

        const completionPath = join(root, "completion.bash");
        writeFileSync(
          completionPath,
          generateCompletion(dispatcherCommand, {
            shell: "bash",
            programName: "mycli",
            mode: "dispatcher",
          }).script,
        );
        const runner = join(root, "run.sh");
        writeFileSync(
          runner,
          [
            `source '${completionPath}'`,
            `COMP_WORDS=('mycli' '')`,
            `COMP_CWORD=1`,
            `COMP_LINE='mycli '`,
            `COMP_POINT=\${#COMP_LINE}`,
            `_mycli_completions`,
            `printf '%s\\n' "\${COMPREPLY[@]}"`,
          ].join("\n"),
        );

        const baseEnv = {
          ...process.env,
          BASH_ENV: "/dev/null",
          HOME: home,
          PATH: `${binDir}:${process.env.PATH}`,
          XDG_CACHE_HOME: xdgCache,
          NODE_COMPILE_CACHE: undefined,
        };
        const fromDefault = childProcessActual.execFileSync(
          "/bin/bash",
          ["--noprofile", "--norc", runner],
          { env: baseEnv, encoding: "utf8", timeout: 1000 },
        );
        expect(fromDefault.trim()).toBe(join(xdgCache, "mycli", "node-compile-cache"));

        const customCache = join(root, "custom-node-cache");
        const fromOverride = childProcessActual.execFileSync(
          "/bin/bash",
          ["--noprofile", "--norc", runner],
          {
            env: { ...baseEnv, NODE_COMPILE_CACHE: customCache },
            encoding: "utf8",
            timeout: 1000,
          },
        );
        expect(fromOverride.trim()).toBe(customCache);
      });
    });

    describe("matcher in static scripts", () => {
      const matcherCmd = defineCommand({
        name: "mycli",
        args: z.object({
          envFile: arg(z.string().optional(), {
            alias: "e",
            completion: { type: "file", matcher: [".env.*"] },
          }),
        }),
        run: () => {},
      });

      it("should generate bash glob pattern filter for matcher", () => {
        const result = generateCompletion(matcherCmd, {
          shell: "bash",
          programName: "mycli",
          mode: "static",
        });
        expect(result.script).toContain('[[ "${_f##*/}" == .env.* ]]');
      });

      it("should generate zsh manual file filtering for matcher", () => {
        const result = generateCompletion(matcherCmd, {
          shell: "zsh",
          programName: "mycli",
          mode: "static",
        });
        expect(result.script).toContain('local -a _matchers=(".env.*")');
        expect(result.script).toContain('for _f in "$_dir"/${~_pat}(N.); do');
      });

      it("should generate fish glob expansion for matcher", () => {
        const result = generateCompletion(matcherCmd, {
          shell: "fish",
          programName: "mycli",
          mode: "static",
        });
        expect(result.script).toContain('"$_dir".env.*');
      });
    });

    it("should throw error for unsupported shell", () => {
      expect(() =>
        generateCompletion(testCommand, {
          shell: "powershell" as any,
          programName: "mycli",
        }),
      ).toThrow("Unsupported shell: powershell");
    });
  });

  describe("getSupportedShells", () => {
    it("should return supported shells", () => {
      const shells = getSupportedShells();

      expect(shells).toContain("bash");
      expect(shells).toContain("zsh");
      expect(shells).toContain("fish");
      expect(shells).toHaveLength(3);
    });
  });

  describe("createCompletionCommand", () => {
    it("should create a valid completion subcommand", () => {
      const mainCmd = defineCommand({
        name: "mycli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: () => {},
      });

      const completionCmd = createCompletionCommand(mainCmd, "mycli");

      expect(completionCmd.name).toBe("completion");
      expect(completionCmd.description).toBe("Generate shell completion script");
      expect(completionCmd.args).toBeDefined();
      expect(completionCmd.run).toBeDefined();
    });

    it("should use rootCommand.name as programName when not specified", () => {
      const mainCmd = defineCommand({
        name: "mycli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: () => {},
      });

      const completionCmd = createCompletionCommand(mainCmd);

      expect(completionCmd.name).toBe("completion");
      expect(completionCmd.description).toBe("Generate shell completion script");
    });

    it("should be usable as a subcommand", () => {
      const mainCmd = defineCommand({
        name: "mycli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: () => {},
      });

      const completionCmd = createCompletionCommand(mainCmd, "mycli");

      const cmdWithCompletion = defineCommand({
        name: "mycli",
        subCommands: {
          completion: completionCmd,
        },
      });

      expect(cmdWithCompletion.subCommands?.completion).toBe(completionCmd);
    });

    it("should add __complete command and output candidates", async () => {
      const mainCmd = defineCommand({
        name: "mycli",
        args: z.object({
          format: arg(z.enum(["json", "yaml"]), { alias: "f" }),
        }),
        run: () => {},
      });

      const completionCmd = createCompletionCommand(mainCmd, "mycli");
      mainCmd.subCommands = { ...mainCmd.subCommands, completion: completionCmd };

      expect(mainCmd.subCommands?.__complete).toBeDefined();

      using consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await runCommand(mainCmd, ["__complete", "--shell", "fish", "--", "--format", ""]);

      const output = consoleSpy.mock.calls
        .map((args) => args.map((value) => String(value)).join(" "))
        .join("\n");

      expect(output).toContain("json");
      expect(output).toContain("yaml");
    });
  });

  describe("withCompletionCommand", () => {
    it("should wrap a command with a completion subcommand", () => {
      const cmd = defineCommand({
        name: "mycli",
        description: "My CLI tool",
        subCommands: {
          build: defineCommand({ name: "build", run: () => {} }),
        },
      });

      const wrapped = withCompletionCommand(cmd);

      expect(wrapped.name).toBe("mycli");
      expect(wrapped.description).toBe("My CLI tool");
      expect(wrapped.subCommands?.build).toBe(cmd.subCommands?.build);
      expect(wrapped.subCommands?.completion).toBeDefined();

      const completionCmd = wrapped.subCommands?.completion;
      expect(typeof completionCmd).toBe("object");
      if (typeof completionCmd === "object" && !isLazyCommand(completionCmd)) {
        expect(completionCmd.name).toBe("completion");
      }
    });

    it("should use command.name as programName by default", () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: {
          test: defineCommand({ name: "test", run: () => {} }),
        },
      });

      const wrapped = withCompletionCommand(cmd);

      expect(wrapped.subCommands?.completion).toBeDefined();
    });

    it("should preserve existing subcommands", () => {
      const buildCmd = defineCommand({ name: "build", run: () => {} });
      const testCmd = defineCommand({ name: "test", run: () => {} });

      const cmd = defineCommand({
        name: "mycli",
        subCommands: { build: buildCmd, test: testCmd },
      });

      const wrapped = withCompletionCommand(cmd);

      expect(wrapped.subCommands?.build).toBe(buildCmd);
      expect(wrapped.subCommands?.test).toBe(testCmd);
      expect(wrapped.subCommands?.completion).toBeDefined();
    });

    it("should generate completion from the wrapped command tree", () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: {
          build: defineCommand({ name: "build", run: () => {} }),
        },
      });

      const wrapped = withCompletionCommand(cmd);
      wrapped.subCommands = {
        ...wrapped.subCommands,
        deploy: defineCommand({ name: "deploy", run: () => {} }),
      };

      const completionSubcommand = wrapped.subCommands?.completion;
      expect(completionSubcommand).toBeDefined();
      if (
        !completionSubcommand ||
        typeof completionSubcommand === "function" ||
        isLazyCommand(completionSubcommand)
      ) {
        throw new Error("Expected completion to be a command object");
      }

      expect(completionSubcommand.run).toBeDefined();
      using consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      completionSubcommand.run?.({ shell: "bash", instructions: false });

      const output = consoleSpy.mock.calls
        .map((args) => args.map((value) => String(value)).join(" "))
        .join("\n");
      // Static script embeds completion metadata
      expect(output).toContain("_mycli_completions");
    });

    it("should always include __complete command", () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: {
          build: defineCommand({ name: "build", run: () => {} }),
        },
      });

      const wrapped = withCompletionCommand(cmd);

      expect(wrapped.subCommands?.__complete).toBeDefined();
      expect(wrapped.subCommands?.completion).toBeDefined();
    });

    it("should hide __complete from help output", async () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: {
          build: defineCommand({ name: "build", run: () => {} }),
        },
      });

      const wrapped = withCompletionCommand(cmd);
      using consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runCommand(wrapped, ["--help"]);

      const output = consoleSpy.mock.calls
        .map((args) => args.map((value) => String(value)).join(" "))
        .join("\n");

      expect(output).toContain("build");
      expect(output).toContain("completion");
      expect(output).not.toContain("__complete");
    });
  });

  describe("Dynamic Completion", () => {
    describe("parseCompletionContext", () => {
      const testCmd = defineCommand({
        name: "mycli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
          format: arg(z.enum(["json", "yaml"]), { alias: "f" }),
        }),
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              watch: arg(z.boolean().default(false), { alias: "w" }),
              output: arg(z.string().optional(), { alias: "o" }),
            }),
            run: () => {},
          }),
          test: defineCommand({
            name: "test",
            run: () => {},
          }),
        },
      });

      it("should detect subcommand completion at root level", () => {
        const ctx = parseCompletionContext([""], testCmd);

        expect(ctx.completionType).toBe("subcommand");
        expect(ctx.subcommands).toContain("build");
        expect(ctx.subcommands).toContain("test");
        expect(ctx.currentWord).toBe("");
      });

      it("should detect option-name completion when starting with -", () => {
        const ctx = parseCompletionContext(["--"], testCmd);

        expect(ctx.completionType).toBe("option-name");
        expect(ctx.currentWord).toBe("--");
      });

      it("should detect option-value completion after option", () => {
        const ctx = parseCompletionContext(["--format", ""], testCmd);

        expect(ctx.completionType).toBe("option-value");
        expect(ctx.targetOption?.cliName).toBe("format");
      });

      it("should navigate into subcommand", () => {
        const ctx = parseCompletionContext(["build", "--"], testCmd);

        expect(ctx.subcommandPath).toEqual(["build"]);
        expect(ctx.completionType).toBe("option-name");
        expect(ctx.options.some((o) => o.cliName === "watch")).toBe(true);
      });

      it("should track used options", () => {
        const ctx = parseCompletionContext(["--verbose", "--"], testCmd);

        expect(ctx.usedOptions.has("verbose")).toBe(true);
        expect(ctx.usedOptions.has("v")).toBe(true);
      });

      it("should handle option with inline value", () => {
        const ctx = parseCompletionContext(["--format="], testCmd);

        expect(ctx.completionType).toBe("option-value");
        expect(ctx.targetOption?.cliName).toBe("format");
      });

      it("should treat arguments after -- as positional", () => {
        const positionalCmd = defineCommand({
          name: "mycli",
          args: z.object({
            target: arg(z.string().optional(), { positional: true }),
          }),
          run: () => {},
        });

        const ctx = parseCompletionContext(["--", "foo", "-"], positionalCmd);

        expect(ctx.currentWord).toBe("-");
        expect(ctx.completionType).toBe("positional");
      });
    });

    describe("generateCandidates", () => {
      const testCmd = defineCommand({
        name: "mycli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
          format: arg(z.enum(["json", "yaml"]), { alias: "f" }),
          tags: arg(z.array(z.string()).default([]), { alias: "t" }),
          config: arg(z.string().optional(), { completion: { type: "file" } }),
          dir: arg(z.string().optional(), { completion: { type: "directory" } }),
        }),
        subCommands: {
          build: defineCommand({ name: "build", description: "Build project", run: () => {} }),
          test: defineCommand({ name: "test", description: "Run tests", run: () => {} }),
        },
      });

      const gen = (ctx: ReturnType<typeof parseCompletionContext>) =>
        generateCandidates(ctx, { shell: "bash" });

      it("should generate subcommand candidates", async () => {
        const ctx = parseCompletionContext([""], testCmd);
        const result = await gen(ctx);

        const subcommandCandidates = result.candidates.filter((c) => c.type === "subcommand");
        expect(subcommandCandidates.some((c) => c.value === "build")).toBe(true);
        expect(subcommandCandidates.some((c) => c.value === "test")).toBe(true);
        // Name completion opts out of the shells' empty-result file fallback.
        expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
      });

      it("should generate option candidates", async () => {
        const ctx = parseCompletionContext(["--"], testCmd);
        const result = await gen(ctx);

        const optionCandidates = result.candidates.filter((c) => c.type === "option");
        expect(optionCandidates.some((c) => c.value === "--verbose")).toBe(true);
        expect(optionCandidates.some((c) => c.value === "--format")).toBe(true);
        expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
      });

      it("should generate enum value candidates for option-value", async () => {
        const ctx = parseCompletionContext(["--format", ""], testCmd);
        const result = await gen(ctx);

        expect(result.candidates.some((c) => c.value === "json")).toBe(true);
        expect(result.candidates.some((c) => c.value === "yaml")).toBe(true);
      });

      it("should set file directive for file completion without extensions", async () => {
        const ctx = parseCompletionContext(["--config", ""], testCmd);
        const result = await gen(ctx);

        expect(result.directive & CompletionDirective.FileCompletion).toBeTruthy();
      });

      it("should pass file extensions to shell via metadata instead of resolving in JS", async () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            config: arg(z.string().optional(), {
              completion: { type: "file", extensions: ["json", "yaml"] },
            }),
          }),
          run: () => {},
        });

        const ctx = parseCompletionContext(["--config", ""], cmd);
        const result = await gen(ctx);

        expect(result.candidates).toHaveLength(0);
        expect(result.directive & CompletionDirective.FileCompletion).toBeFalsy();
        expect(result.fileExtensions).toEqual(["json", "yaml"]);
      });

      it("should pass file matchers to shell via metadata instead of resolving in JS", async () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            envFile: arg(z.string().optional(), {
              completion: { type: "file", matcher: [".env.*"] },
            }),
          }),
          run: () => {},
        });

        const ctx = parseCompletionContext(["--env-file", ""], cmd);
        const result = await gen(ctx);

        expect(result.candidates).toHaveLength(0);
        expect(result.directive & CompletionDirective.FileCompletion).toBeFalsy();
        expect(result.fileMatchers).toEqual([".env.*"]);
        expect(result.fileExtensions).toBeUndefined();
      });

      it("should set directory directive for directory completion", async () => {
        const ctx = parseCompletionContext(["--dir", ""], testCmd);
        const result = await gen(ctx);

        expect(result.directive & CompletionDirective.DirectoryCompletion).toBeTruthy();
      });

      it("should filter out used options", async () => {
        const ctx = parseCompletionContext(["--verbose", "--"], testCmd);
        const result = await gen(ctx);

        const optionCandidates = result.candidates.filter((c) => c.type === "option");
        expect(optionCandidates.some((c) => c.value === "--verbose")).toBe(false);
      });

      it("should keep array options available after they are used", async () => {
        const ctx = parseCompletionContext(["--tags", "one", "--"], testCmd);
        const result = await gen(ctx);

        const optionCandidates = result.candidates.filter((c) => c.type === "option");
        expect(optionCandidates.some((c) => c.value === "--tags")).toBe(true);
      });

      it("should set NoFileCompletion for enum value completion", async () => {
        const ctx = parseCompletionContext(["--format", ""], testCmd);
        const result = await gen(ctx);

        expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
      });

      it("should set NoFileCompletion for custom choices completion", async () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            env: arg(z.string(), {
              completion: { custom: { choices: ["dev", "staging", "prod"] } },
            }),
          }),
          run: () => {},
        });

        const ctx = parseCompletionContext(["--env", ""], cmd);
        const result = await gen(ctx);

        expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
      });

      it("should include custom negation as an option candidate", async () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            cache: arg(z.boolean().default(true), {
              negation: "disable-cache",
              negationDescription: "Disable the cache",
            }),
          }),
          run: () => {},
        });

        const ctx = parseCompletionContext(["--"], cmd);
        const result = await gen(ctx);

        const optionCandidates = result.candidates.filter((c) => c.type === "option");
        expect(optionCandidates.some((c) => c.value === "--cache")).toBe(true);
        const negation = optionCandidates.find((c) => c.value === "--disable-cache");
        expect(negation).toBeDefined();
        expect(negation?.description).toBe("Disable the cache");
      });

      it("should treat positive flag and custom negation as mutually exclusive", async () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            cache: arg(z.boolean().default(true), { negation: "disable-cache" }),
            other: arg(z.boolean().default(false)),
          }),
          run: () => {},
        });

        // Typing --cache hides both --cache and --disable-cache
        const ctx1 = parseCompletionContext(["--cache", "--"], cmd);
        const opts1 = (await gen(ctx1)).candidates.filter((c) => c.type === "option");
        expect(opts1.some((c) => c.value === "--cache")).toBe(false);
        expect(opts1.some((c) => c.value === "--disable-cache")).toBe(false);
        expect(opts1.some((c) => c.value === "--other")).toBe(true);

        // Typing --disable-cache also hides both
        const ctx2 = parseCompletionContext(["--disable-cache", "--"], cmd);
        const opts2 = (await gen(ctx2)).candidates.filter((c) => c.type === "option");
        expect(opts2.some((c) => c.value === "--cache")).toBe(false);
        expect(opts2.some((c) => c.value === "--disable-cache")).toBe(false);
        expect(opts2.some((c) => c.value === "--other")).toBe(true);
      });

      it("should resolve shellCommand in JS instead of using markers", async () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            item: arg(z.string().optional(), {
              completion: {
                custom: { shellCommand: "printf 'foo\\nbar\\nbaz'" },
              },
            }),
          }),
          run: () => {},
        });

        const ctx = parseCompletionContext(["--item", ""], cmd);
        const result = await gen(ctx);

        expect(result.candidates.some((c) => c.value.startsWith("__command:"))).toBe(false);
        expect(result.candidates.some((c) => c.value === "foo")).toBe(true);
        expect(result.candidates.some((c) => c.value === "bar")).toBe(true);
        expect(result.candidates.some((c) => c.value === "baz")).toBe(true);
      });
    });

    describe("formatForShell", () => {
      it("should format for fish with descriptions", () => {
        const result = {
          candidates: [
            { value: "build", description: "Build project", type: "subcommand" as const },
            { value: "test", description: "Run tests", type: "subcommand" as const },
          ],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatForShell(result, { shell: "fish", currentWord: "" });
        const lines = output.split("\n");

        expect(lines[0]).toBe("build\tBuild project");
        expect(lines[1]).toBe("test\tRun tests");
        expect(lines[2]).toBe(":4"); // FilterPrefix = 4
      });

      it("should format for fish without descriptions", () => {
        const result = {
          candidates: [{ value: "json" }, { value: "yaml" }],
          directive: CompletionDirective.Default,
        };

        const output = formatForShell(result, { shell: "fish", currentWord: "" });
        const lines = output.split("\n");

        expect(lines[0]).toBe("json");
        expect(lines[1]).toBe("yaml");
        expect(lines[2]).toBe(":0");
      });

      it("should format for zsh with colon-separated descriptions", () => {
        const result = {
          candidates: [
            { value: "build", description: "Build project", type: "subcommand" as const },
            { value: "test", description: "Run tests", type: "subcommand" as const },
          ],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatForShell(result, { shell: "zsh", currentWord: "" });
        const lines = output.split("\n");

        expect(lines[0]).toBe("build:Build project");
        expect(lines[1]).toBe("test:Run tests");
        expect(lines[2]).toBe(":4");
      });

      it("should escape colons in zsh output", () => {
        const result = {
          candidates: [{ value: "http://example.com", description: "URL with: colons" }],
          directive: CompletionDirective.Default,
        };

        const output = formatForShell(result, { shell: "zsh", currentWord: "" });
        const lines = output.split("\n");

        expect(lines[0]).toBe("http\\://example.com:URL with\\: colons");
      });

      it("should format for bash with values only (no descriptions)", () => {
        const result = {
          candidates: [
            { value: "build", description: "Build project", type: "subcommand" as const },
            { value: "test", description: "Run tests", type: "subcommand" as const },
          ],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatForShell(result, { shell: "bash", currentWord: "" });
        const lines = output.split("\n");

        expect(lines[0]).toBe("build");
        expect(lines[1]).toBe("test");
        expect(lines[2]).toBe(":4");
      });

      it("should filter by prefix for bash", () => {
        const result = {
          candidates: [
            { value: "build", type: "subcommand" as const },
            { value: "bench", type: "subcommand" as const },
            { value: "test", type: "subcommand" as const },
          ],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatForShell(result, { shell: "bash", currentWord: "b" });
        const lines = output.split("\n");

        expect(lines).toContain("build");
        expect(lines).toContain("bench");
        expect(lines).not.toContain("test");
      });

      it("should prepend inline prefix for bash", () => {
        const result = {
          candidates: [
            { value: "json", type: "value" as const },
            { value: "yaml", type: "value" as const },
          ],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatForShell(result, {
          shell: "bash",
          currentWord: "",
          inlinePrefix: "--format=",
        });
        const lines = output.split("\n");

        expect(lines[0]).toBe("--format=json");
        expect(lines[1]).toBe("--format=yaml");
      });

      it("should include @matcher: metadata on the trailing directive line", () => {
        const result: Parameters<typeof formatForShell>[0] = {
          candidates: [],
          directive: CompletionDirective.FilterPrefix,
          fileMatchers: [".env.*"],
        };

        const output = formatForShell(result, { shell: "bash", currentWord: "" });

        // Metadata rides on the directive sentinel (tab-separated), not a
        // standalone line, so candidate lines stay unambiguous.
        expect(output).toBe(`:${CompletionDirective.FilterPrefix}\t@matcher:.env.*`);
      });

      it("keeps candidate values that look like @ext:/@matcher: metadata distinct", () => {
        const directive = CompletionDirective.FilterPrefix | CompletionDirective.NoFileCompletion;
        const result: Parameters<typeof formatForShell>[0] = {
          candidates: [{ value: "@ext:tsx" }, { value: "normal" }],
          directive,
        };

        const output = formatForShell(result, { shell: "bash", currentWord: "" });
        const lines = output.split("\n");

        // A resolver candidate that begins with `@ext:` must remain a candidate
        // line; metadata/directive live only on the final line.
        expect(lines[0]).toBe("@ext:tsx");
        expect(lines[1]).toBe("normal");
        expect(lines[lines.length - 1]).toBe(`:${directive}`);
      });

      it("should not include @matcher: when fileMatchers is empty", () => {
        const result: Parameters<typeof formatForShell>[0] = {
          candidates: [],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatForShell(result, { shell: "bash", currentWord: "" });
        expect(output).not.toContain("@matcher:");
      });
    });

    describe("createDynamicCompleteCommand", () => {
      it("should create __complete command", () => {
        const mainCmd = defineCommand({
          name: "mycli",
          args: z.object({
            verbose: arg(z.boolean().default(false), { alias: "v" }),
          }),
          run: () => {},
        });

        const completeCmd = createDynamicCompleteCommand(mainCmd);

        expect(completeCmd.name).toBe("__complete");
        expect(completeCmd.run).toBeDefined();
      });

      it("should output completion candidates when run", async () => {
        const mainCmd = defineCommand({
          name: "mycli",
          args: z.object({
            format: arg(z.enum(["json", "yaml"]), { alias: "f" }),
          }),
          run: () => {},
        });

        const completeCmd = createDynamicCompleteCommand(mainCmd);

        using consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        await completeCmd.run?.({ shell: "fish", args: ["--format", ""] });

        const output = consoleSpy.mock.calls
          .map((args) => args.map((value) => String(value)).join(" "))
          .join("\n");

        expect(output).toContain("json");
        expect(output).toContain("yaml");
      });
    });

    describe("completion scripts", () => {
      it("should generate static bash completion script", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            verbose: arg(z.boolean().default(false), { alias: "v" }),
          }),
          run: () => {},
        });

        const result = generateCompletion(cmd, {
          shell: "bash",
          programName: "mycli",
          mode: "static",
        });

        expect(result.script).toContain("# program: mycli");
        expect(result.script).toContain("# shell: bash");
        expect(result.script).toContain("_mycli_completions");
        expect(result.script).toContain("complete -o default -F _mycli_completions mycli");
      });

      it("should generate static zsh completion script", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            verbose: arg(z.boolean().default(false), { alias: "v" }),
          }),
          run: () => {},
        });

        const result = generateCompletion(cmd, {
          shell: "zsh",
          programName: "mycli",
          mode: "static",
        });

        expect(result.script).toContain("# program: mycli");
        expect(result.script).toContain("# shell: zsh");
        expect(result.script).toContain("#compdef mycli");
        expect(result.script).toContain("compdef _mycli mycli");
      });

      it("should generate static fish completion script", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            verbose: arg(z.boolean().default(false), { alias: "v" }),
          }),
          run: () => {},
        });

        const result = generateCompletion(cmd, {
          shell: "fish",
          programName: "mycli",
          mode: "static",
        });

        expect(result.script).toContain("# program: mycli");
        expect(result.script).toContain("# shell: fish");
        expect(result.script).toContain("__fish_mycli_complete");
        expect(result.script).toContain("complete -c mycli -f");
      });

      it("should generate valid script for command with no subcommands", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            verbose: arg(z.boolean().default(false), { alias: "v" }),
            output: arg(z.string().optional(), { alias: "o" }),
          }),
          run: () => {},
        });

        for (const shell of ["bash", "zsh", "fish"] as const) {
          const result = generateCompletion(cmd, { shell, programName: "mycli", mode: "static" });

          // Should not contain empty else branch (bash/zsh syntax error)
          expect(result.script).not.toMatch(/else\s*\n\s*(fi|end)/);

          // Should still contain option completion
          expect(result.script).toContain("--verbose");
          expect(result.script).toContain("--output");
        }
      });

      it("should include opt_takes_value fallback for value-taking options without completion", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            config: arg(z.string().optional(), { alias: "c" }),
          }),
          subCommands: {
            build: defineCommand({ name: "build", run: () => {} }),
          },
        });

        for (const shell of ["bash", "zsh", "fish"] as const) {
          const result = generateCompletion(cmd, { shell, programName: "mycli", mode: "static" });

          // Should contain opt_takes_value fallback check
          expect(result.script).toContain("opt_takes_value");
        }
      });

      it("should include root positional completion when no subcommands", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            file: arg(z.enum(["a.txt", "b.txt"]), {
              positional: true,
              description: "Input file",
            }),
          }),
          run: () => {},
        });

        for (const shell of ["bash", "zsh", "fish"] as const) {
          const result = generateCompletion(cmd, { shell, programName: "mycli", mode: "static" });

          // Should contain positional value candidates in the root handler
          expect(result.script).toContain("a.txt");
          expect(result.script).toContain("b.txt");
        }
      });

      it("should escape shell-special characters in descriptions", () => {
        const cmd = defineCommand({
          name: "mycli",
          subCommands: {
            build: defineCommand({
              name: "build",
              description: 'Build "the" project ($var)',
              run: () => {},
            }),
          },
        });

        for (const shell of ["zsh", "fish"] as const) {
          const result = generateCompletion(cmd, { shell, programName: "mycli", mode: "static" });

          // Should not contain unescaped double quotes inside description strings
          // The raw description 'Build "the" project ($var)' should be escaped
          expect(result.script).not.toContain('Build "the"');
          expect(result.script).toContain('\\"the\\"');

          // Dollar sign should be escaped
          expect(result.script).not.toMatch(/\(\$var\)/);
          expect(result.script).toContain("\\$var");
        }
      });

      it("should keep array options always available in generated scripts", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            tags: arg(z.array(z.string()).default([]), {
              description: "Tags",
            }),
            name: arg(z.string().optional()),
          }),
          run: () => {},
        });

        for (const shell of ["bash", "zsh", "fish"] as const) {
          const result = generateCompletion(cmd, { shell, programName: "mycli", mode: "static" });

          // Array option --tags should NOT go through not_used filter
          expect(result.script).not.toMatch(/not_used.*"--tags"/);

          // Non-array option --name should still use not_used filter
          expect(result.script).toMatch(/not_used.*"--name"/);
        }
      });

      it("should reset used-options tracking when entering subcommand scope", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            verbose: arg(z.boolean().default(false)),
          }),
          subCommands: {
            build: defineCommand({
              name: "build",
              args: z.object({
                target: arg(z.string().optional()),
              }),
              run: () => {},
            }),
          },
        });

        const bashResult = generateCompletion(cmd, {
          shell: "bash",
          programName: "mycli",
          mode: "static",
        });
        // _used_opts should be reset when entering a subcommand via is_subcmd
        expect(bashResult.script).toContain("_used_opts=(); _pos_count=0");
        expect(bashResult.script).toContain("__mycli_is_subcmd");

        const zshResult = generateCompletion(cmd, {
          shell: "zsh",
          programName: "mycli",
          mode: "static",
        });
        expect(zshResult.script).toContain("_used_opts=(); _pos_count=0");
        expect(zshResult.script).toContain("__mycli_is_subcmd");

        const fishResult = generateCompletion(cmd, {
          shell: "fish",
          programName: "mycli",
          mode: "static",
        });
        expect(fishResult.script).toContain("set _used_opts; set _pos_count 0");
        expect(fishResult.script).toContain("__mycli_is_subcmd");
      });

      it("should escape special characters in choice values", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            mode: arg(z.enum(["normal", 'say "hi"', "cost$5"]), {
              positional: true,
            }),
          }),
          run: () => {},
        });

        // Bash: choice values should be escaped in array literals
        const bashResult = generateCompletion(cmd, {
          shell: "bash",
          programName: "mycli",
          mode: "static",
        });
        expect(bashResult.script).toContain('say \\"hi\\"');
        expect(bashResult.script).toContain("cost\\$5");

        // Zsh: choice values should be escaped via escapeDesc
        const zshResult = generateCompletion(cmd, {
          shell: "zsh",
          programName: "mycli",
          mode: "static",
        });
        expect(zshResult.script).toContain('\\"hi\\"');
        expect(zshResult.script).toContain("\\$5");

        // Fish: choice values should be escaped via escapeDesc
        const fishResult = generateCompletion(cmd, {
          shell: "fish",
          programName: "mycli",
          mode: "static",
        });
        expect(fishResult.script).toContain('\\"hi\\"');
        expect(fishResult.script).toContain("\\$5");
      });

      it("should not include __command or __extensions handling in any shell script", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            branch: arg(z.string().optional(), {
              completion: {
                custom: { shellCommand: "git branch --format='%(refname:short)'" },
              },
            }),
          }),
          run: () => {},
        });

        for (const shell of ["bash", "zsh", "fish"] as const) {
          const result = generateCompletion(cmd, {
            shell,
            programName: "mycli",
          });

          expect(result.script).not.toContain("__command:");
          expect(result.script).not.toContain("__extensions:");
          expect(result.script).not.toContain("command_completion");
        }
      });
    });
  });

  describe("CompletionMeta type constraints", () => {
    it("should accept extensions without matcher", () => {
      expectTypeOf<{ type: "file"; extensions: string[] }>().toMatchTypeOf<CompletionMeta>();
    });

    it("should accept matcher without extensions", () => {
      expectTypeOf<{ type: "file"; matcher: string[] }>().toMatchTypeOf<CompletionMeta>();
    });

    it("should reject both matcher and extensions", () => {
      expectTypeOf<{
        type: "file";
        matcher: string[];
        extensions: string[];
      }>().not.toMatchTypeOf<CompletionMeta>();
    });
  });

  describe("static-script header", () => {
    const cmd = defineCommand({ name: "mycli", run: () => {} });

    it("embeds bin-sig + program-version in bash header when both are set", () => {
      const fakeBin = join(mkdtempSync(join(tmpdir(), "politty-bin-")), "mycli");
      writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
      const result = generateCompletion(cmd, {
        shell: "bash",
        programName: "mycli",
        binPath: fakeBin,
        programVersion: "1.2.3",
        mode: "static",
      });
      const expectedSig = Math.floor(statSync(fakeBin).mtimeMs / 1000).toString();
      expect(result.script).toContain(`# politty-bin-sig: ${expectedSig}`);
      expect(result.script).toContain("# program-version: 1.2.3");
      expect(result.script).toContain("# shell: bash");
    });

    it("falls back to bin-sig 0 when binPath is unreadable", () => {
      const result = generateCompletion(cmd, {
        shell: "zsh",
        programName: "mycli",
        binPath: "/nonexistent/path/to/binary",
        mode: "static",
      });
      expect(result.script).toContain("# politty-bin-sig: 0");
    });

    it("does not emit program-version line when not provided", () => {
      const result = generateCompletion(cmd, {
        shell: "fish",
        programName: "mycli",
        mode: "static",
      });
      expect(result.script).not.toContain("# program-version:");
    });

    it("embeds a bash self-refresh guard in static scripts", () => {
      const fakeBin = join(mkdtempSync(join(tmpdir(), "politty-bin-")), "mycli");
      writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
      const { script } = generateCompletion(cmd, {
        shell: "bash",
        programName: "mycli",
        binPath: fakeBin,
        mode: "static",
      });

      expect(script).toContain("__mycli_self_refresh()");
      expect(script).toContain('"$_bin" __refresh-completion bash "$_self" --static 2>/dev/null');
      expect(script).toContain('source "$_self" 2>/dev/null');
      expect(script).toContain('head -n 8 "$_self"');
      // Resolve the bin like resolveBinPath (env override → PATH) so the
      // self-refresh sig check matches the embedded `# politty-bin-sig`.
      expect(script).toContain('_bin="${MYCLI_BIN:-$(type -P mycli 2>/dev/null)}"');
    });

    it("embeds a zsh self-refresh guard in static scripts", () => {
      const fakeBin = join(mkdtempSync(join(tmpdir(), "politty-bin-")), "mycli");
      writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
      const { script } = generateCompletion(cmd, {
        shell: "zsh",
        programName: "mycli",
        binPath: fakeBin,
        mode: "static",
      });

      expect(script).toContain("__mycli_self_refresh()");
      expect(script).toContain('_self="${(%):-%x}"');
      expect(script).toContain('"$_bin" __refresh-completion zsh "$_self" --static 2>/dev/null');
      expect(script).toContain('source "$_self" 2>/dev/null');
      expect(script).toContain('_mycli "$@"');
      expect(script).not.toContain('_mycli "$@" || return 1');
      expect(script).toContain('if __mycli_self_refresh "$@"; then');
      expect(script).toContain('_bin="${MYCLI_BIN:-$(whence -p mycli 2>/dev/null)}"');
    });

    it("zsh self-refresh re-enters the fpath entrypoint for dashed program names", () => {
      const fakeBin = join(mkdtempSync(join(tmpdir(), "politty-bin-")), "tailor-sdk");
      writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
      const { script } = generateCompletion(cmd, {
        shell: "zsh",
        programName: "tailor-sdk",
        binPath: fakeBin,
        mode: "static",
      });

      expect(script).toContain("__tailor_sdk_self_refresh()");
      expect(script).toContain('_tailor-sdk "$@"');
      expect(script).not.toContain('_tailor_sdk "$@"');
    });

    it("fish self-refresh honors the bin override before PATH", () => {
      const fakeBin = join(mkdtempSync(join(tmpdir(), "politty-bin-")), "mycli");
      writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
      const { script } = generateCompletion(cmd, {
        shell: "fish",
        programName: "mycli",
        binPath: fakeBin,
        mode: "static",
      });

      // Resolve the bin like resolveBinPath (env override → PATH) so the sig
      // check stats the same binary the embedded sig was computed from.
      expect(script).toContain("set -l _bin $MYCLI_BIN");
      expect(script).toContain('test -z "$_bin"; and set _bin (command -v mycli)');
    });
  });

  describe("install / refreshIfStale", () => {
    const cmd = defineCommand({ name: "mycli", run: () => {} });
    let cacheDir: string;
    let fakeBin: string;

    beforeEach(() => {
      const root = mkdtempSync(join(tmpdir(), "politty-install-"));
      cacheDir = join(root, "cache");
      fakeBin = join(root, "mycli");
      writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
    });

    it("installPath puts bash/zsh under cacheDir/completion.<shell>", () => {
      expect(installPath("mycli", "bash", cacheDir)).toBe(join(cacheDir, "completion.bash"));
      expect(installPath("mycli", "zsh", cacheDir)).toBe(join(cacheDir, "completion.zsh"));
    });

    it("installPath routes fish to $XDG_CONFIG_HOME/fish/completions/<prog>.fish", () => {
      using _env = useEnv({ XDG_CONFIG_HOME: "/tmp/cfg" });
      expect(installPath("mycli", "fish")).toBe("/tmp/cfg/fish/completions/mycli.fish");
    });

    it("install writes the script atomically with the embedded bin-sig", () => {
      const target = install(
        { rootCommand: cmd, programName: "mycli", cacheDir, binPath: fakeBin },
        "bash",
      );
      expect(target).toBe(join(cacheDir, "completion.bash"));
      const sig = Math.floor(statSync(fakeBin).mtimeMs / 1000).toString();
      const written = readFileSync(target, "utf8");
      expect(written).toContain(`# politty-bin-sig: ${sig}`);
      expect(written).toContain("_mycli_completions");
    });

    it("refreshIfStale rewrites the cache when bin-sig differs", () => {
      const target = install(
        { rootCommand: cmd, programName: "mycli", cacheDir, binPath: fakeBin },
        "bash",
      );
      const originalSig = Math.floor(statSync(fakeBin).mtimeMs / 1000).toString();

      // Bump the binary mtime by 5s — this should force a rewrite.
      const bumped = new Date(statSync(fakeBin).mtimeMs + 5000);
      utimesSync(fakeBin, bumped, bumped);

      refreshIfStale(
        { rootCommand: cmd, programName: "mycli", cacheDir, binPath: fakeBin },
        "bash",
      );
      const after = readFileSync(target, "utf8");
      const newSig = Math.floor(statSync(fakeBin).mtimeMs / 1000).toString();
      expect(newSig).not.toBe(originalSig);
      expect(after).toContain(`# politty-bin-sig: ${newSig}`);
    });

    it("refreshIfStale keeps a legacy (mode-less) cache static rather than dispatcher", () => {
      const target = join(cacheDir, "completion.bash");
      mkdirSync(cacheDir, { recursive: true });
      // A completion file from a release predating dispatcher mode: managed
      // headers, no `# politty-completion-mode`, and a stale sig to force a
      // rewrite. The refresh must not silently upgrade it to dispatcher.
      writeFileSync(
        target,
        `${[
          "# politty-completion-version: 1",
          "# politty-bin-sig: 0",
          "# program: mycli",
          "# shell: bash",
          "_mycli_completions() { :; }",
        ].join("\n")}\n`,
      );

      refreshIfStale(
        { rootCommand: cmd, programName: "mycli", cacheDir, binPath: fakeBin },
        "bash",
      );

      const after = readFileSync(target, "utf8");
      expect(after).toContain("# politty-completion-mode: static");
      expect(after).not.toContain("# politty-completion-mode: dispatcher");
    });

    it("refreshIfStale rewrites a matching politty-generated target file", () => {
      const target = join(mkdtempSync(join(tmpdir(), "politty-static-")), "mycli-completion.bash");
      writeFileSync(
        target,
        generateCompletion(cmd, {
          shell: "bash",
          programName: "mycli",
          binPath: fakeBin,
        }).script,
      );
      const originalSig = Math.floor(statSync(fakeBin).mtimeMs / 1000).toString();

      const bumped = new Date(statSync(fakeBin).mtimeMs + 5000);
      utimesSync(fakeBin, bumped, bumped);

      refreshIfStale(
        { rootCommand: cmd, programName: "mycli", binPath: fakeBin, targetPath: target },
        "bash",
      );
      const after = readFileSync(target, "utf8");
      const newSig = Math.floor(statSync(fakeBin).mtimeMs / 1000).toString();
      expect(newSig).not.toBe(originalSig);
      expect(after).toContain(`# politty-bin-sig: ${newSig}`);
    });

    it("refreshIfStale does not overwrite arbitrary target files", () => {
      const target = join(mkdtempSync(join(tmpdir(), "politty-static-")), "not-completion.bash");
      writeFileSync(target, "important user file\n");

      refreshIfStale(
        { rootCommand: cmd, programName: "mycli", binPath: fakeBin, targetPath: target },
        "bash",
      );

      expect(readFileSync(target, "utf8")).toBe("important user file\n");
    });

    it("refreshIfStale leaves the cache untouched when bin-sig matches", () => {
      const target = install(
        { rootCommand: cmd, programName: "mycli", cacheDir, binPath: fakeBin },
        "zsh",
      );
      const beforeMtime = statSync(target).mtimeMs;
      // Sleep-free guarantee: same bin = same sig, so nothing should be rewritten.
      refreshIfStale({ rootCommand: cmd, programName: "mycli", cacheDir, binPath: fakeBin }, "zsh");
      expect(statSync(target).mtimeMs).toBe(beforeMtime);
    });

    it("refreshIfStale never throws on a bogus binPath", () => {
      expect(() =>
        refreshIfStale(
          { rootCommand: cmd, programName: "mycli", cacheDir, binPath: "/nope/missing" },
          "bash",
        ),
      ).not.toThrow();
    });

    it("hasManagedCache returns false when the cache file does not exist", () => {
      expect(hasManagedCache({ programName: "mycli", cacheDir }, "bash")).toBe(false);
    });

    it("hasManagedCache returns false for a non-politty cache file", () => {
      const target = installPath("mycli", "bash", cacheDir);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "# user-managed\ncomplete -c mycli\n");
      expect(hasManagedCache({ programName: "mycli", cacheDir }, "bash")).toBe(false);
    });

    it("hasManagedCache returns true once install has run", () => {
      install({ rootCommand: cmd, programName: "mycli", cacheDir, binPath: fakeBin }, "bash");
      expect(hasManagedCache({ programName: "mycli", cacheDir }, "bash")).toBe(true);
    });
  });

  describe("generateLoader", () => {
    it("emits a bash loader that sources the cache file", () => {
      const snippet = generateLoader({ programName: "mycli", shell: "bash" });
      expect(snippet).toContain("__mycli_load_completion()");
      expect(snippet).toContain("politty-bin-sig:");
      expect(snippet).toContain("completion.bash");
      expect(snippet).toContain('source "$_cache"');
    });

    it("emits a zsh loader with no_aliases and emulate -L zsh", () => {
      const snippet = generateLoader({ programName: "mycli", shell: "zsh" });
      expect(snippet).toContain("emulate -L zsh");
      expect(snippet).toContain("setopt local_options no_aliases");
      expect(snippet).toContain("completion.zsh");
    });

    it("resolves the bin via the env override before PATH to match the header sig", () => {
      // `# politty-bin-sig` is computed from resolveBinPath (env override →
      // PATH). The loader's freshness check must stat the same binary, or a set
      // `<PROG>_BIN` that differs from PATH would mismatch and regenerate forever.
      expect(generateLoader({ programName: "mycli", shell: "bash" })).toContain(
        '_bin="${MYCLI_BIN:-$(type -P mycli 2>/dev/null)}"',
      );
      expect(generateLoader({ programName: "mycli", shell: "zsh" })).toContain(
        '_bin="${MYCLI_BIN:-$(whence -p mycli 2>/dev/null)}"',
      );
    });

    it("hardcodes the cache directory when cacheDir is provided", () => {
      const snippet = generateLoader({
        programName: "mycli",
        shell: "bash",
        cacheDir: "/opt/cache",
      });
      expect(snippet).toContain("'/opt/cache/completion.bash'");
      expect(snippet).not.toContain("XDG_CACHE_HOME");
    });

    it("single-quote escapes hardcoded cache paths so shell metachars stay inert", () => {
      const snippet = generateLoader({
        programName: "mycli",
        shell: "bash",
        cacheDir: "/opt/$(rm -rf)/cache's",
      });
      // Path appears once, fully single-quoted, with `'` escaped via `'\''`.
      expect(snippet).toContain("'/opt/$(rm -rf)/cache'\\''s/completion.bash'");
      // No naked `$(...)` that would run on source.
      expect(snippet).not.toContain('"/opt/$(rm -rf)/cache');
    });

    it("throws for fish — fish uses an autoload file instead", () => {
      expect(() => generateLoader({ programName: "mycli", shell: "fish" })).toThrow(
        /fish does not use an rc loader/,
      );
    });
  });

  describe("defaultCacheDir", () => {
    it("uses XDG_CACHE_HOME when set", () => {
      using _env = useEnv({ XDG_CACHE_HOME: "/var/cache" });
      expect(defaultCacheDir("mycli")).toBe("/var/cache/mycli");
    });

    it("falls back to $HOME/.cache when XDG_CACHE_HOME is unset", () => {
      using _env = useEnv({ XDG_CACHE_HOME: undefined, HOME: "/home/alice" });
      expect(defaultCacheDir("mycli")).toBe("/home/alice/.cache/mycli");
    });
  });

  describe("fish self-rewriting autoload", () => {
    const cmd = defineCommand({ name: "mycli", run: () => {} });

    it("invokes __refresh-completion (not `completion fish`) and bails out of the stale body on success", () => {
      const fakeBin = join(mkdtempSync(join(tmpdir(), "politty-bin-")), "mycli");
      writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
      const { script } = generateCompletion(cmd, {
        shell: "fish",
        programName: "mycli",
        binPath: fakeBin,
        mode: "static",
      });
      // Refresh body uses the hidden subcommand so user setup/cleanup/prompt is skipped.
      expect(script).toContain('"$_bin" __refresh-completion fish "$_target" --static 2>/dev/null');
      expect(script).toContain("set -l _target (status current-filename)");
      // The stale body must be skipped after a successful refresh.
      expect(script).toContain("set -l _politty_refreshed $status");
      expect(script).toContain("test $_politty_refreshed -eq 0; and return");
      // GNU stat probed before BSD stat (otherwise BSD stat -f reports filesystem mode).
      expect(script).toContain("stat -L -c '%Y'");
      expect(script).toContain("stat -L -f '%m'");
    });

    it("embeds the resolved bin-sig so the refresh function can early-exit when fresh", () => {
      const fakeBin = join(mkdtempSync(join(tmpdir(), "politty-bin-")), "mycli");
      writeFileSync(fakeBin, "#!/bin/sh\n");
      const sig = Math.floor(statSync(fakeBin).mtimeMs / 1000).toString();
      const { script } = generateCompletion(cmd, {
        shell: "fish",
        programName: "mycli",
        binPath: fakeBin,
        mode: "static",
      });
      expect(script).toContain(`test "$_sig" = "${sig}"; and return 1`);
    });
  });

  describe("completion subcommand --install / --loader flags", () => {
    let cacheDir: string;
    let fakeBin: string;
    const cmd = defineCommand({ name: "mycli", run: () => {} });

    beforeEach(() => {
      const root = mkdtempSync(join(tmpdir(), "politty-installflag-"));
      cacheDir = join(root, "cache");
      fakeBin = join(root, "mycli");
      writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
    });

    it("--install writes the script to the cache and prints the loader snippet to stderr (bash)", () => {
      const subcommand = createCompletionCommand(cmd, "mycli", undefined, { cacheDir });
      const captured: string[] = [];
      using _errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      });
      subcommand.run?.({
        shell: "bash",
        instructions: false,
        install: true,
        loader: false,
        static: false,
        dispatcher: false,
        worker: false,
      });

      const target = join(cacheDir, "completion.bash");
      const written = readFileSync(target, "utf8");
      expect(written).toContain("# politty-bin-sig:");
      expect(written).toContain("_mycli_completions");

      const stderr = captured.join("\n");
      expect(stderr).toContain(`installed: ${target}`);
      expect(stderr).toContain("Add to your ~/.bashrc:");
      expect(stderr).toContain("__mycli_load_completion()");
    });

    it("--install for zsh prints fpath setup instead of a loader snippet", () => {
      const subcommand = createCompletionCommand(cmd, "mycli", undefined, { cacheDir });
      const captured: string[] = [];
      const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      });
      try {
        subcommand.run?.({
          shell: "zsh",
          instructions: false,
          install: true,
          loader: false,
          static: false,
          dispatcher: false,
          worker: false,
        });

        const target = join(cacheDir, "completion.zsh");
        const written = readFileSync(target, "utf8");
        expect(written).toContain("# politty-bin-sig:");
        expect(written).toContain("_mycli()");

        const stderr = captured.join("\n");
        expect(stderr).toContain(`installed: ${target}`);
        expect(stderr).toContain("Configure zsh fpath with:");
        expect(stderr).toContain(`ln -sf '${target}' ~/.zsh/completions/_mycli`);
        expect(stderr).not.toContain("rm -f ~/.zsh/completions/_mycli");
        expect(stderr).toContain("fpath=(~/.zsh/completions $fpath)");
        expect(stderr).not.toContain("__mycli_load_completion()");
        expect(stderr).not.toContain("Add to your ~/.zshrc:");
      } finally {
        errSpy.mockRestore();
      }
    });

    it("--install for fish writes the autoload file and does NOT print a loader snippet", () => {
      const cfgRoot = mkdtempSync(join(tmpdir(), "politty-fishcfg-"));
      using _env = useEnv({ XDG_CONFIG_HOME: cfgRoot });

      const subcommand = createCompletionCommand(cmd, "mycli", undefined, { cacheDir });
      const captured: string[] = [];
      using _errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      });
      subcommand.run?.({
        shell: "fish",
        instructions: false,
        install: true,
        loader: false,
        static: false,
        dispatcher: false,
        worker: false,
      });

      const target = join(cfgRoot, "fish", "completions", "mycli.fish");
      expect(readFileSync(target, "utf8")).toContain("# shell: fish");
      const stderr = captured.join("\n");
      expect(stderr).toContain(`installed: ${target}`);
      // Fish has no rc-loader story; we must not tell the user to paste anything.
      expect(stderr).not.toContain("Add to your ~/");
    });

    it("--loader prints just the rc loader to stdout (no script body)", () => {
      const subcommand = createCompletionCommand(cmd, "mycli", undefined, { cacheDir });
      const captured: string[] = [];
      using _writeSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: string | Uint8Array): boolean => {
          captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
          return true;
        });
      subcommand.run?.({
        shell: "zsh",
        instructions: false,
        install: false,
        loader: true,
        static: false,
        dispatcher: false,
        worker: false,
      });

      const out = captured.join("");
      expect(out).toContain("__mycli_load_completion()");
      expect(out).toContain("emulate -L zsh");
      // Loader must NOT contain the full completion script body.
      expect(out).not.toContain("_mycli_completions");
      expect(out).not.toContain("#compdef mycli");
    });

    it("--loader for fish throws because fish uses an autoload file instead", () => {
      const subcommand = createCompletionCommand(cmd, "mycli");
      expect(() =>
        subcommand.run?.({
          shell: "fish",
          instructions: false,
          install: false,
          loader: true,
          static: false,
          dispatcher: false,
          worker: false,
        }),
      ).toThrow(/fish does not use an rc loader/);
    });
  });

  describe("__refresh-completion subcommand registration", () => {
    it("withCompletionCommand registers __refresh-completion so the loader can call it", () => {
      const wrapped = withCompletionCommand(defineCommand({ name: "mycli", run: () => {} }));
      const refresh = wrapped.subCommands?.["__refresh-completion"];
      expect(refresh).toBeDefined();
      if (!refresh || typeof refresh === "function" || isLazyCommand(refresh)) {
        throw new Error("expected __refresh-completion to be a registered command object");
      }
      expect(refresh.name).toBe("__refresh-completion");
    });

    it("createCompletionCommand also auto-registers __refresh-completion on the root", () => {
      // Without this, host CLIs that wire `completion: createCompletionCommand(...)` directly
      // would generate loaders that shell out to a subcommand the CLI never exposed.
      const root = defineCommand({ name: "mycli", run: () => {} });
      createCompletionCommand(root, "mycli");
      expect(root.subCommands?.["__refresh-completion"]).toBeDefined();
    });

    it("registers __completion-worker-path for bundled worker discovery", () => {
      const wrapped = withCompletionCommand(defineCommand({ name: "mycli", run: () => {} }));
      const workerPath = wrapped.subCommands?.["__completion-worker-path"];
      expect(workerPath).toBeDefined();
      if (!workerPath || typeof workerPath === "function" || isLazyCommand(workerPath)) {
        throw new Error("expected __completion-worker-path to be a registered command object");
      }
      expect(workerPath.name).toBe("__completion-worker-path");
    });

    it("__completion-worker-path prints an existing bundled worker and otherwise throws", () => {
      const root = mkdtempSync(join(tmpdir(), "politty-worker-path-"));
      const distDir = join(root, "dist");
      const completionDir = join(distDir, "completion");
      mkdirSync(completionDir, { recursive: true });
      const bin = join(distDir, "mycli");
      writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
      const worker = join(completionDir, "zsh-worker.zsh");
      writeFileSync(
        worker,
        [
          "# politty-completion-version: 1",
          "# program: mycli",
          "# shell: zsh",
          "# politty-completion-mode: worker",
          "# politty-completion-worker: true",
        ].join("\n"),
      );

      const command = createCompletionWorkerPathCommand("mycli", { binPath: bin });
      const captured: string[] = [];
      using _logSpy = vi.spyOn(console, "log").mockImplementation((value: unknown) => {
        captured.push(String(value));
      });

      command.run?.({ shell: "zsh" });
      expect(captured).toEqual([worker]);

      const missing = createCompletionWorkerPathCommand("missing", { binPath: bin });
      // A miss must throw so runMain surfaces a non-zero exit code; a bare
      // `process.exitCode = 1` would be overwritten by runMain's process.exit.
      expect(() => missing.run?.({ shell: "zsh" })).toThrow(/No bundled completion worker/);
    });

    it("completion --static --worker prints a worker artifact", () => {
      const root = defineCommand({ name: "mycli", run: () => {} });
      const subcommand = createCompletionCommand(root, "mycli");
      const captured: string[] = [];
      using _logSpy = vi.spyOn(console, "log").mockImplementation((value: unknown) => {
        captured.push(String(value));
      });

      subcommand.run?.({
        shell: "zsh",
        instructions: false,
        install: false,
        loader: false,
        static: true,
        dispatcher: false,
        worker: true,
      });

      const script = captured.join("\n");
      expect(script).toContain("# politty-completion-mode: worker");
      expect(script).toContain("# politty-completion-worker: true");
      expect(script).toContain("_mycli_worker_completions()");
      expect(script).not.toContain("compdef _mycli_worker_completions");
    });
  });

  describe("withCompletionCommand runMainHook (background refresh gates)", () => {
    const setupManagedRefreshHook = () => {
      const cacheDir = mkdtempSync(join(tmpdir(), "politty-hook-"));
      // Pre-populate a politty-managed cache so `hasManagedCache` returns true,
      // letting us isolate the *other* gates one at a time.
      const fakeBin = join(cacheDir, "mycli");
      writeFileSync(fakeBin, "#!/bin/sh\n");
      install(
        {
          rootCommand: defineCommand({ name: "mycli", run: () => {} }),
          programName: "mycli",
          cacheDir,
          binPath: fakeBin,
        },
        "bash",
      );
      const wrapped = withCompletionCommand(defineCommand({ name: "mycli", run: () => {} }), {
        programName: "mycli",
        cacheDir,
      });
      spawnSpy.mockClear();
      return { cacheDir, wrapped };
    };

    it("spawns a detached refresh child for ordinary CLI invocations", () => {
      using _env = useEnv({
        SHELL: "/usr/local/bin/bash",
        POLITTY_NO_COMPLETION_REFRESH: undefined,
      });
      const { wrapped } = setupManagedRefreshHook();

      wrapped.runMainHook?.(["build", "--watch"]);
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const [, spawnArgs, opts] = spawnSpy.mock.calls[0]!;
      expect(spawnArgs).toContain("__refresh-completion");
      expect(spawnArgs).toContain("bash");
      expect(opts).toMatchObject({ detached: true, stdio: "ignore" });
    });

    it("opt-out via POLITTY_NO_COMPLETION_REFRESH skips the spawn", () => {
      using _env = useEnv({
        SHELL: "/usr/local/bin/bash",
        POLITTY_NO_COMPLETION_REFRESH: undefined,
      });
      const { wrapped } = setupManagedRefreshHook();

      process.env.POLITTY_NO_COMPLETION_REFRESH = "1";
      wrapped.runMainHook?.(["build"]);
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it("invocations of completion / __complete / __refresh-completion never re-spawn", () => {
      using _env = useEnv({
        SHELL: "/usr/local/bin/bash",
        POLITTY_NO_COMPLETION_REFRESH: undefined,
      });
      const { wrapped } = setupManagedRefreshHook();

      wrapped.runMainHook?.(["completion", "bash"]);
      wrapped.runMainHook?.(["__complete", "anything"]);
      wrapped.runMainHook?.(["__refresh-completion", "bash"]);
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it("skips the spawn when no managed cache exists yet (avoids creating files the user never opted into)", () => {
      using _env = useEnv({
        SHELL: "/usr/local/bin/bash",
        POLITTY_NO_COMPLETION_REFRESH: undefined,
      });
      // Point at an empty cacheDir so `hasManagedCache` returns false.
      const emptyDir = mkdtempSync(join(tmpdir(), "politty-hook-empty-"));
      const w = withCompletionCommand(defineCommand({ name: "mycli", run: () => {} }), {
        programName: "mycli",
        cacheDir: emptyDir,
      });
      spawnSpy.mockClear();
      w.runMainHook?.(["build"]);
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it("skips the spawn when $SHELL is unrecognized", () => {
      using _env = useEnv({
        SHELL: "/usr/local/bin/bash",
        POLITTY_NO_COMPLETION_REFRESH: undefined,
      });
      const { wrapped } = setupManagedRefreshHook();

      process.env.SHELL = "/bin/dash";
      wrapped.runMainHook?.(["build"]);
      expect(spawnSpy).not.toHaveBeenCalled();
    });
  });
});
