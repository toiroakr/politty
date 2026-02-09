import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createCompletionCommand,
  extractCompletionData,
  generateCompletion,
  getSupportedShells,
} from "../src/completion/index.js";
import { arg, defineCommand } from "../src/index.js";

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
      expect(verboseOpt?.alias).toBe("v");
      expect(verboseOpt?.description).toBe("Enable verbose output");
      expect(verboseOpt?.takesValue).toBe(false); // boolean flag

      const outputOpt = data.command.options.find((o) => o.name === "output");
      expect(outputOpt).toBeDefined();
      expect(outputOpt?.alias).toBe("o");
      expect(outputOpt?.takesValue).toBe(true); // string requires value
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
        expect(result.script).toContain("# Bash completion for mycli");
        expect(result.script).toContain("_mycli_completions()");
        expect(result.script).toContain("complete -F _mycli_completions mycli");
        expect(result.script).toContain("--verbose");
        expect(result.script).toContain("-v");
        expect(result.script).toContain("build");
        expect(result.script).toContain("test");
      });

      it("should include installation instructions", () => {
        const result = generateCompletion(testCommand, {
          shell: "bash",
          programName: "mycli",
        });

        expect(result.installInstructions).toContain("~/.bashrc");
        expect(result.installInstructions).toContain("mycli completion bash");
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
        expect(result.script).toContain("# Zsh completion for mycli");
        expect(result.script).toContain("_mycli()");
        expect(result.script).toContain("--verbose");
        expect(result.script).toContain("build");
        expect(result.script).toContain("test");
      });

      it("should include descriptions in zsh format", () => {
        const result = generateCompletion(testCommand, {
          shell: "zsh",
          programName: "mycli",
          includeDescriptions: true,
        });

        expect(result.script).toContain("Verbose output");
        expect(result.script).toContain("Build the project");
      });
    });

    describe("fish completion", () => {
      it("should generate valid fish completion script", () => {
        const result = generateCompletion(testCommand, {
          shell: "fish",
          programName: "mycli",
        });

        expect(result.shell).toBe("fish");
        expect(result.script).toContain("# Fish completion for mycli");
        expect(result.script).toContain("complete -c mycli");
        expect(result.script).toContain("-l verbose");
        expect(result.script).toContain("-s v");
      });

      it("should include descriptions in fish format", () => {
        const result = generateCompletion(testCommand, {
          shell: "fish",
          programName: "mycli",
          includeDescriptions: true,
        });

        expect(result.script).toContain("-d 'Verbose output'");
      });

      it("should include helper functions", () => {
        const result = generateCompletion(testCommand, {
          shell: "fish",
          programName: "mycli",
        });

        expect(result.script).toContain("function __fish_use_subcommand_mycli");
        expect(result.script).toContain("function __fish_mycli_using_command");
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
  });
});
