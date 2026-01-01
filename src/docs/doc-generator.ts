import { getExtractedFields } from "../core/schema-extractor.js";
import { resolveLazyCommand } from "../executor/subcommand-router.js";
import type { AnyCommand, CommandExample } from "../types.js";
import type { CommandInfo, ExampleRunnerFunction, SubCommandInfo } from "./types.js";

/**
 * Run examples and capture output
 */
async function runExamples(
  command: AnyCommand,
  examples: CommandExample[] | undefined,
  exampleRunner: ExampleRunnerFunction | undefined,
): Promise<CommandExample[] | undefined> {
  if (!examples || examples.length === 0) {
    return examples;
  }

  if (!exampleRunner) {
    return examples;
  }

  const results: CommandExample[] = [];
  for (const example of examples) {
    const result = await exampleRunner(command, example.args);
    results.push({
      ...example,
      output: result.output,
    });
  }
  return results;
}

/**
 * Build CommandInfo from a command
 */
export async function buildCommandInfo(
  command: AnyCommand,
  rootName: string,
  commandPath: string[] = [],
  exampleRunner?: ExampleRunnerFunction,
): Promise<CommandInfo> {
  const extracted = getExtractedFields(command);

  const positionalArgs = extracted?.fields.filter((f) => f.positional) ?? [];
  const options = extracted?.fields.filter((f) => !f.positional) ?? [];

  const subCommands: SubCommandInfo[] = [];
  if (command.subCommands) {
    for (const [name, subCmd] of Object.entries(command.subCommands)) {
      const resolved = await resolveLazyCommand(subCmd);
      const fullPath = [...commandPath, name];
      subCommands.push({
        name,
        description: resolved.description,
        fullPath,
      });
    }
  }

  // Run examples if runner is provided
  const examples = await runExamples(command, command.examples, exampleRunner);

  return {
    name: command.name ?? "",
    description: command.description,
    fullCommandPath: commandPath.length > 0 ? `${rootName} ${commandPath.join(" ")}` : rootName,
    commandPath: commandPath.join(" "),
    positionalArgs,
    options,
    subCommands,
    extracted,
    command,
    notes: command.notes,
    examples,
  };
}

/**
 * Collect all commands with their paths
 * Returns a map of command path -> CommandInfo
 */
export async function collectAllCommands(
  command: AnyCommand,
  rootName?: string,
  exampleRunner?: ExampleRunnerFunction,
): Promise<Map<string, CommandInfo>> {
  const root = rootName ?? command.name ?? "command";
  const result = new Map<string, CommandInfo>();

  async function traverse(cmd: AnyCommand, path: string[]): Promise<void> {
    const info = await buildCommandInfo(cmd, root, path, exampleRunner);
    const pathKey = path.join(" ");
    result.set(pathKey, info);

    if (cmd.subCommands) {
      for (const [name, subCmd] of Object.entries(cmd.subCommands)) {
        const resolved = await resolveLazyCommand(subCmd);
        await traverse(resolved, [...path, name]);
      }
    }
  }

  await traverse(command, []);
  return result;
}
