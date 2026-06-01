import type * as childProcess from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  CompletionDirective,
  createCompletionCommand,
  createDynamicCompleteCommand,
  extractCompletionData,
  formatForShell,
  generateCandidates,
  generateCompletion,
  getSupportedShells,
  parseCompletionContext,
  withCompletionCommand,
} from "../src/completion/index.js";
import {
  hasManagedCache,
  install,
  installPath,
  refreshIfStale,
} from "../src/completion/install.js";
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
const spawnSpy = vi.mocked(childProcessMock.spawn);

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
        });
        expect(result.script).toContain('[[ "${_f##*/}" == .env.* ]]');
      });

      it("should generate zsh _files -g for matcher", () => {
        const result = generateCompletion(matcherCmd, {
          shell: "zsh",
          programName: "mycli",
        });
        expect(result.script).toContain('_files -g ".env.*"');
      });

      it("should generate fish glob expansion for matcher", () => {
        const result = generateCompletion(matcherCmd, {
          shell: "fish",
          programName: "mycli",
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

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await runCommand(mainCmd, ["__complete", "--shell", "fish", "--", "--format", ""]);

      const output = consoleSpy.mock.calls
        .map((args) => args.map((value) => String(value)).join(" "))
        .join("\n");
      consoleSpy.mockRestore();

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
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      completionSubcommand.run?.({ shell: "bash", instructions: false });

      const output = consoleSpy.mock.calls
        .map((args) => args.map((value) => String(value)).join(" "))
        .join("\n");
      consoleSpy.mockRestore();
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
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runCommand(wrapped, ["--help"]);

      const output = consoleSpy.mock.calls
        .map((args) => args.map((value) => String(value)).join(" "))
        .join("\n");

      consoleSpy.mockRestore();

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
      });

      it("should generate option candidates", async () => {
        const ctx = parseCompletionContext(["--"], testCmd);
        const result = await gen(ctx);

        const optionCandidates = result.candidates.filter((c) => c.type === "option");
        expect(optionCandidates.some((c) => c.value === "--verbose")).toBe(true);
        expect(optionCandidates.some((c) => c.value === "--format")).toBe(true);
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

      it("should include @matcher: metadata for file matchers", () => {
        const result: Parameters<typeof formatForShell>[0] = {
          candidates: [],
          directive: CompletionDirective.FilterPrefix,
          fileMatchers: [".env.*"],
        };

        const output = formatForShell(result, { shell: "bash", currentWord: "" });
        const lines = output.split("\n");

        expect(lines).toContain("@matcher:.env.*");
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

        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        await completeCmd.run?.({ shell: "fish", args: ["--format", ""] });

        const output = consoleSpy.mock.calls
          .map((args) => args.map((value) => String(value)).join(" "))
          .join("\n");
        consoleSpy.mockRestore();

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
          const result = generateCompletion(cmd, { shell, programName: "mycli" });

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
          const result = generateCompletion(cmd, { shell, programName: "mycli" });

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
          const result = generateCompletion(cmd, { shell, programName: "mycli" });

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
          const result = generateCompletion(cmd, { shell, programName: "mycli" });

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
          const result = generateCompletion(cmd, { shell, programName: "mycli" });

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

        const bashResult = generateCompletion(cmd, { shell: "bash", programName: "mycli" });
        // _used_opts should be reset when entering a subcommand via is_subcmd
        expect(bashResult.script).toContain("_used_opts=(); _pos_count=0");
        expect(bashResult.script).toContain("__mycli_is_subcmd");

        const zshResult = generateCompletion(cmd, { shell: "zsh", programName: "mycli" });
        expect(zshResult.script).toContain("_used_opts=(); _pos_count=0");
        expect(zshResult.script).toContain("__mycli_is_subcmd");

        const fishResult = generateCompletion(cmd, { shell: "fish", programName: "mycli" });
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
        const bashResult = generateCompletion(cmd, { shell: "bash", programName: "mycli" });
        expect(bashResult.script).toContain('say \\"hi\\"');
        expect(bashResult.script).toContain("cost\\$5");

        // Zsh: choice values should be escaped via escapeDesc
        const zshResult = generateCompletion(cmd, { shell: "zsh", programName: "mycli" });
        expect(zshResult.script).toContain('\\"hi\\"');
        expect(zshResult.script).toContain("\\$5");

        // Fish: choice values should be escaped via escapeDesc
        const fishResult = generateCompletion(cmd, { shell: "fish", programName: "mycli" });
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
      });
      expect(result.script).toContain("# politty-bin-sig: 0");
    });

    it("does not emit program-version line when not provided", () => {
      const result = generateCompletion(cmd, {
        shell: "fish",
        programName: "mycli",
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
      });

      expect(script).toContain("__mycli_self_refresh()");
      expect(script).toContain('"$_bin" __refresh-completion bash "$_self" 2>/dev/null');
      expect(script).toContain('source "$_self" 2>/dev/null');
      expect(script).toContain('head -n 8 "$_self"');
    });

    it("embeds a zsh self-refresh guard in static scripts", () => {
      const fakeBin = join(mkdtempSync(join(tmpdir(), "politty-bin-")), "mycli");
      writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
      const { script } = generateCompletion(cmd, {
        shell: "zsh",
        programName: "mycli",
        binPath: fakeBin,
      });

      expect(script).toContain("__mycli_self_refresh()");
      expect(script).toContain('_self="${(%):-%x}"');
      expect(script).toContain('"$_bin" __refresh-completion zsh "$_self" 2>/dev/null');
      expect(script).toContain('source "$_self" 2>/dev/null');
      expect(script).toContain('_mycli "$@"');
      expect(script).not.toContain('_mycli "$@" || return 1');
      expect(script).toContain('if __mycli_self_refresh "$@"; then');
    });

    it("zsh self-refresh re-enters the fpath entrypoint for dashed program names", () => {
      const fakeBin = join(mkdtempSync(join(tmpdir(), "politty-bin-")), "tailor-sdk");
      writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n");
      const { script } = generateCompletion(cmd, {
        shell: "zsh",
        programName: "tailor-sdk",
        binPath: fakeBin,
      });

      expect(script).toContain("__tailor_sdk_self_refresh()");
      expect(script).toContain('_tailor-sdk "$@"');
      expect(script).not.toContain('_tailor_sdk "$@"');
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
      const prev = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = "/tmp/cfg";
      try {
        expect(installPath("mycli", "fish")).toBe("/tmp/cfg/fish/completions/mycli.fish");
      } finally {
        if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = prev;
      }
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
    let prevXdg: string | undefined;
    let prevHome: string | undefined;

    beforeEach(() => {
      prevXdg = process.env.XDG_CACHE_HOME;
      prevHome = process.env.HOME;
    });

    afterEach(() => {
      if (prevXdg === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = prevXdg;
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    });

    it("uses XDG_CACHE_HOME when set", () => {
      process.env.XDG_CACHE_HOME = "/var/cache";
      expect(defaultCacheDir("mycli")).toBe("/var/cache/mycli");
    });

    it("falls back to $HOME/.cache when XDG_CACHE_HOME is unset", () => {
      delete process.env.XDG_CACHE_HOME;
      process.env.HOME = "/home/alice";
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
      });
      // Refresh body uses the hidden subcommand so user setup/cleanup/prompt is skipped.
      expect(script).toContain('"$_bin" __refresh-completion fish "$_target" 2>/dev/null');
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
      const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      });
      try {
        subcommand.run?.({ shell: "bash", instructions: false, install: true, loader: false });

        const target = join(cacheDir, "completion.bash");
        const written = readFileSync(target, "utf8");
        expect(written).toContain("# politty-bin-sig:");
        expect(written).toContain("_mycli_completions");

        const stderr = captured.join("\n");
        expect(stderr).toContain(`installed: ${target}`);
        expect(stderr).toContain("Add to your ~/.bashrc:");
        expect(stderr).toContain("__mycli_load_completion()");
      } finally {
        errSpy.mockRestore();
      }
    });

    it("--install for zsh prints fpath setup instead of a loader snippet", () => {
      const subcommand = createCompletionCommand(cmd, "mycli", undefined, { cacheDir });
      const captured: string[] = [];
      const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      });
      try {
        subcommand.run?.({ shell: "zsh", instructions: false, install: true, loader: false });

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
      const prevXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = cfgRoot;

      const subcommand = createCompletionCommand(cmd, "mycli", undefined, { cacheDir });
      const captured: string[] = [];
      const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      });
      try {
        subcommand.run?.({ shell: "fish", instructions: false, install: true, loader: false });

        const target = join(cfgRoot, "fish", "completions", "mycli.fish");
        expect(readFileSync(target, "utf8")).toContain("# shell: fish");
        const stderr = captured.join("\n");
        expect(stderr).toContain(`installed: ${target}`);
        // Fish has no rc-loader story; we must not tell the user to paste anything.
        expect(stderr).not.toContain("Add to your ~/");
      } finally {
        errSpy.mockRestore();
        if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = prevXdg;
      }
    });

    it("--loader prints just the rc loader to stdout (no script body)", () => {
      const subcommand = createCompletionCommand(cmd, "mycli", undefined, { cacheDir });
      const captured: string[] = [];
      const writeSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: string | Uint8Array): boolean => {
          captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
          return true;
        });
      try {
        subcommand.run?.({ shell: "zsh", instructions: false, install: false, loader: true });

        const out = captured.join("");
        expect(out).toContain("__mycli_load_completion()");
        expect(out).toContain("emulate -L zsh");
        // Loader must NOT contain the full completion script body.
        expect(out).not.toContain("_mycli_completions");
        expect(out).not.toContain("#compdef mycli");
      } finally {
        writeSpy.mockRestore();
      }
    });

    it("--loader for fish throws because fish uses an autoload file instead", () => {
      const subcommand = createCompletionCommand(cmd, "mycli");
      expect(() =>
        subcommand.run?.({ shell: "fish", instructions: false, install: false, loader: true }),
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
  });

  describe("withCompletionCommand runMainHook (background refresh gates)", () => {
    let cacheDir: string;
    let prevShell: string | undefined;
    let prevOptOut: string | undefined;
    let wrapped: ReturnType<typeof withCompletionCommand>;

    beforeEach(() => {
      cacheDir = mkdtempSync(join(tmpdir(), "politty-hook-"));
      prevShell = process.env.SHELL;
      prevOptOut = process.env.POLITTY_NO_COMPLETION_REFRESH;
      process.env.SHELL = "/usr/local/bin/bash";
      delete process.env.POLITTY_NO_COMPLETION_REFRESH;
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
      wrapped = withCompletionCommand(defineCommand({ name: "mycli", run: () => {} }), {
        programName: "mycli",
        cacheDir,
      });
      spawnSpy.mockClear();
    });

    afterEach(() => {
      if (prevShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = prevShell;
      if (prevOptOut === undefined) delete process.env.POLITTY_NO_COMPLETION_REFRESH;
      else process.env.POLITTY_NO_COMPLETION_REFRESH = prevOptOut;
    });

    it("spawns a detached refresh child for ordinary CLI invocations", () => {
      wrapped.runMainHook?.(["build", "--watch"]);
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const [, spawnArgs, opts] = spawnSpy.mock.calls[0]!;
      expect(spawnArgs).toContain("__refresh-completion");
      expect(spawnArgs).toContain("bash");
      expect(opts).toMatchObject({ detached: true, stdio: "ignore" });
    });

    it("opt-out via POLITTY_NO_COMPLETION_REFRESH skips the spawn", () => {
      process.env.POLITTY_NO_COMPLETION_REFRESH = "1";
      wrapped.runMainHook?.(["build"]);
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it("invocations of completion / __complete / __refresh-completion never re-spawn", () => {
      wrapped.runMainHook?.(["completion", "bash"]);
      wrapped.runMainHook?.(["__complete", "anything"]);
      wrapped.runMainHook?.(["__refresh-completion", "bash"]);
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it("skips the spawn when no managed cache exists yet (avoids creating files the user never opted into)", () => {
      // Point at an empty cacheDir so `hasManagedCache` returns false.
      const emptyDir = mkdtempSync(join(tmpdir(), "politty-hook-empty-"));
      const w = withCompletionCommand(defineCommand({ name: "mycli", run: () => {} }), {
        programName: "mycli",
        cacheDir: emptyDir,
      });
      w.runMainHook?.(["build"]);
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it("skips the spawn when $SHELL is unrecognized", () => {
      process.env.SHELL = "/bin/dash";
      wrapped.runMainHook?.(["build"]);
      expect(spawnSpy).not.toHaveBeenCalled();
    });
  });
});
