/**
 * Zsh completion script generator
 */

import type { AnyCommand } from "../types.js";
import { extractCompletionData } from "./extractor.js";
import type {
  CompletableOption,
  CompletablePositional,
  CompletableSubcommand,
  CompletionOptions,
  CompletionResult,
  ValueCompletion,
} from "./types.js";

/**
 * Escape a string for use in zsh completion descriptions
 */
function escapeForZsh(str: string): string {
  return str.replace(/'/g, "''").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

/**
 * Generate value completion action for zsh _arguments
 */
function generateValueCompletionAction(vc: ValueCompletion | undefined): string {
  if (!vc) return ":value:";

  switch (vc.type) {
    case "choices": {
      const choices = vc.choices?.map((c) => escapeForZsh(c)).join(" ") ?? "";
      return `:value:(${choices})`;
    }
    case "file":
      if (vc.extensions && vc.extensions.length > 0) {
        const pattern = vc.extensions.map((e) => `*.${e}`).join("|");
        return `:file:_files -g '(${pattern})'`;
      }
      return ":file:_files";
    case "directory":
      return ":directory:_files -/";
    case "command":
      if (vc.shellCommand) {
        // Use a subshell to execute the command
        return `:value:{local -a vals; vals=($(${vc.shellCommand} 2>/dev/null)); _describe 'value' vals}`;
      }
      return ":value:";
    case "none":
      return ": :";
    default:
      return ":value:";
  }
}

/**
 * Generate option specs for zsh _arguments
 */
function generateOptionSpecs(options: CompletableOption[], includeDescriptions: boolean): string[] {
  const specs: string[] = [];

  for (const opt of options) {
    const desc = includeDescriptions && opt.description ? escapeForZsh(opt.description) : "";

    // Determine value spec based on completion type
    let valueSpec = "";
    if (opt.takesValue) {
      valueSpec = generateValueCompletionAction(opt.valueCompletion);
    }

    // Long option
    if (desc) {
      specs.push(`'--${opt.cliName}[${desc}]${valueSpec}'`);
    } else {
      specs.push(`'--${opt.cliName}${valueSpec}'`);
    }

    // Short option (alias)
    if (opt.alias) {
      if (desc) {
        specs.push(`'-${opt.alias}[${desc}]${valueSpec}'`);
      } else {
        specs.push(`'-${opt.alias}${valueSpec}'`);
      }
    }
  }

  return specs;
}

/**
 * Generate positional argument specs for zsh _arguments
 */
function generatePositionalSpecs(
  positionals: CompletablePositional[],
  includeDescriptions: boolean,
): string[] {
  return positionals.map((pos) => {
    const desc =
      includeDescriptions && pos.description ? escapeForZsh(pos.description) : pos.cliName;

    const vc = pos.valueCompletion;
    let action = "";

    if (vc) {
      switch (vc.type) {
        case "choices": {
          const choices = vc.choices?.map((c) => escapeForZsh(c)).join(" ") ?? "";
          action = `(${choices})`;
          break;
        }
        case "file":
          if (vc.extensions && vc.extensions.length > 0) {
            const pattern = vc.extensions.map((e) => `*.${e}`).join("|");
            action = `_files -g '(${pattern})'`;
          } else {
            action = "_files";
          }
          break;
        case "directory":
          action = "_files -/";
          break;
        case "command":
          if (vc.shellCommand) {
            action = `{local -a vals; vals=($(${vc.shellCommand} 2>/dev/null)); _describe 'value' vals}`;
          }
          break;
        case "none":
          // No completion
          break;
        default:
          break;
      }
    }

    // Required positionals use single colon, optional use double colon
    const required = pos.required ? ":" : "::";
    return `'${pos.position + 1}${required}${desc}:${action}'`;
  });
}

/**
 * Generate subcommand descriptions for zsh
 */
function generateSubcommandDescriptions(
  subcommands: CompletableSubcommand[],
  includeDescriptions: boolean,
): string {
  if (subcommands.length === 0) {
    return "";
  }

  const lines = subcommands.map((sub) => {
    const desc = includeDescriptions && sub.description ? escapeForZsh(sub.description) : sub.name;
    return `'${sub.name}:${desc}'`;
  });

  return lines.join("\n            ");
}

/**
 * Generate a zsh function for a subcommand
 */
function generateSubcommandFunction(
  command: CompletableSubcommand,
  programName: string,
  includeDescriptions: boolean,
  parentPath: string[] = [],
): string {
  const currentPath = [...parentPath, command.name];
  const funcName =
    parentPath.length === 0
      ? `_${programName}`
      : `_${programName}_${currentPath.slice(1).join("_")}`;

  const optionSpecs = generateOptionSpecs(command.options, includeDescriptions);
  const positionalSpecs = generatePositionalSpecs(command.positionals, includeDescriptions);
  const hasSubcommands = command.subcommands.length > 0;

  let func = `${funcName}() {\n`;
  func += `    local -a args\n`;

  if (hasSubcommands) {
    const subcommandDesc = generateSubcommandDescriptions(command.subcommands, includeDescriptions);
    func += `    local -a subcommands\n`;
    func += `    subcommands=(\n`;
    func += `            ${subcommandDesc}\n`;
    func += `    )\n\n`;
  }

  func += `    args=(\n`;

  if (hasSubcommands) {
    func += `        '1:command:->command'\n`;
    func += `        '*::arg:->args'\n`;
  } else {
    // Add positional specs only when there are no subcommands
    for (const spec of positionalSpecs) {
      func += `        ${spec}\n`;
    }
  }

  for (const spec of optionSpecs) {
    func += `        ${spec}\n`;
  }

  func += `    )\n\n`;

  func += `    _arguments -s -S $args\n\n`;

  if (hasSubcommands) {
    func += `    case "$state" in\n`;
    func += `        command)\n`;
    func += `            _describe -t commands 'command' subcommands\n`;
    func += `            ;;\n`;
    func += `        args)\n`;
    func += `            case $words[1] in\n`;

    for (const sub of command.subcommands) {
      const subFuncName = `_${programName}_${[...currentPath.slice(1), sub.name].join("_")}`;
      func += `                ${sub.name})\n`;
      func += `                    ${subFuncName}\n`;
      func += `                    ;;\n`;
    }

    func += `            esac\n`;
    func += `            ;;\n`;
    func += `    esac\n`;
  }

  func += `}\n`;

  return func;
}

/**
 * Collect all subcommand functions recursively
 */
function collectSubcommandFunctions(
  command: CompletableSubcommand,
  programName: string,
  includeDescriptions: boolean,
  parentPath: string[] = [],
): string[] {
  const functions: string[] = [];

  // Generate function for this command
  functions.push(generateSubcommandFunction(command, programName, includeDescriptions, parentPath));

  // Generate functions for subcommands
  const currentPath = parentPath.length === 0 ? [command.name] : [...parentPath, command.name];

  for (const sub of command.subcommands) {
    functions.push(
      ...collectSubcommandFunctions(sub, programName, includeDescriptions, currentPath),
    );
  }

  return functions;
}

/**
 * Generate the zsh completion script
 */
function generateZshScript(
  command: CompletableSubcommand,
  programName: string,
  includeDescriptions: boolean,
): string {
  const functions = collectSubcommandFunctions(command, programName, includeDescriptions);

  return `#compdef ${programName}

# Zsh completion for ${programName}
# Generated by politty

${functions.join("\n")}

compdef _${programName} ${programName}
`;
}

/**
 * Generate zsh completion script for a command
 */
export function generateZshCompletion(
  command: AnyCommand,
  options: CompletionOptions,
): CompletionResult {
  const data = extractCompletionData(command, options.programName);
  const includeDescriptions = options.includeDescriptions ?? true;

  const script = generateZshScript(data.command, options.programName, includeDescriptions);

  return {
    script,
    shell: "zsh",
    installInstructions: `# To enable completions, add the following to your ~/.zshrc:

# Option 1: Source directly (add before compinit)
eval "$(${options.programName} completion zsh)"

# Option 2: Save to a file in your fpath
${options.programName} completion zsh > ~/.zsh/completions/_${options.programName}

# Make sure your fpath includes the completions directory:
# fpath=(~/.zsh/completions $fpath)
# autoload -Uz compinit && compinit

# Then reload your shell or run:
source ~/.zshrc`,
  };
}

/**
 * Generate dynamic zsh completion script that calls __complete command
 */
export function generateDynamicZshScript(programName: string): string {
  return `#compdef ${programName}

# Zsh dynamic completion for ${programName}
# Generated by politty
# This script calls the CLI to generate completions dynamically

_${programName}() {
    local -a candidates
    local output line directive=0

    # Get the current words being completed
    local -a args
    args=("\${words[@]:1}")

    # Call the CLI to get completions
    output=("\${(@f)$(${programName} __complete -- "\${args[@]}" 2>/dev/null)}")

    # Parse output
    for line in "\${output[@]}"; do
        if [[ "$line" == :* ]]; then
            directive="\${line:1}"
        elif [[ -n "$line" ]]; then
            local name="\${line%%$'\\t'*}"
            local desc="\${line#*$'\\t'}"
            if [[ "$name" == "$desc" ]]; then
                candidates+=("$name")
            else
                candidates+=("$name:$desc")
            fi
        fi
    done

    # Handle directives
    # 16 = FileCompletion, 32 = DirectoryCompletion
    if (( directive & 16 )); then
        _files
    elif (( directive & 32 )); then
        _files -/
    elif (( \${#candidates[@]} > 0 )); then
        _describe 'completions' candidates
    fi
}

compdef _${programName} ${programName}
`;
}
