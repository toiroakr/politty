/**
 * Fish completion script generator
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
 * Escape a string for use in fish completion descriptions
 */
function escapeForFish(str: string): string {
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

/**
 * Generate value completion flags for fish
 */
function generateValueCompletionFlags(vc: ValueCompletion | undefined): string {
  if (!vc) return "-r"; // Default: require argument

  switch (vc.type) {
    case "choices": {
      const choices = vc.choices?.map((c) => escapeForFish(c)).join(" ") ?? "";
      return `-r -f -a "${choices}"`;
    }
    case "file":
      // Fish has file completion by default with -r
      // -F forces file completion
      return "-r -F";
    case "directory":
      return "-r -f -a '(__fish_complete_directories)'";
    case "command":
      if (vc.shellCommand) {
        return `-r -f -a '(${vc.shellCommand} 2>/dev/null)'`;
      }
      return "-r";
    case "none":
      return "-r -f"; // Require arg but no suggestions
    default:
      return "-r";
  }
}

/**
 * Generate completion entries for options
 */
function generateOptionCompletions(
  options: CompletableOption[],
  programName: string,
  condition: string,
  includeDescriptions: boolean,
): string[] {
  const completions: string[] = [];

  for (const opt of options) {
    let cmd = `complete -c ${programName}`;

    // Add condition if specified
    if (condition) {
      cmd += ` -n '${condition}'`;
    }

    // Add long option
    cmd += ` -l ${opt.cliName}`;

    // Add short option if exists
    if (opt.alias) {
      cmd += ` -s ${opt.alias}`;
    }

    // Add flag for options that take values
    if (opt.takesValue) {
      cmd += ` ${generateValueCompletionFlags(opt.valueCompletion)}`;
    } else {
      cmd += " -f"; // No argument (flag)
    }

    // Add description
    if (includeDescriptions && opt.description) {
      cmd += ` -d '${escapeForFish(opt.description)}'`;
    }

    completions.push(cmd);
  }

  return completions;
}

/**
 * Generate completion entries for subcommands
 */
function generateSubcommandCompletions(
  subcommands: CompletableSubcommand[],
  programName: string,
  condition: string,
  includeDescriptions: boolean,
): string[] {
  const completions: string[] = [];

  for (const sub of subcommands) {
    let cmd = `complete -c ${programName}`;

    // Add condition
    if (condition) {
      cmd += ` -n '${condition}'`;
    }

    // Subcommands are exclusive (no prefix)
    cmd += ` -f -a ${sub.name}`;

    // Add description
    if (includeDescriptions && sub.description) {
      cmd += ` -d '${escapeForFish(sub.description)}'`;
    }

    completions.push(cmd);
  }

  return completions;
}

/**
 * Generate completion entries for positional arguments
 */
function generatePositionalCompletions(
  positionals: CompletablePositional[],
  programName: string,
  parentCommands: string[],
  includeDescriptions: boolean,
): string[] {
  const completions: string[] = [];

  for (const pos of positionals) {
    const vc = pos.valueCompletion;
    if (!vc || vc.type === "none") continue;

    let cmd = `complete -c ${programName}`;

    // Add condition for positional position
    const posCondition =
      parentCommands.length === 0
        ? `__fish_${programName}_needs_positional ${pos.position}`
        : `__fish_${programName}_using_command ${parentCommands[parentCommands.length - 1]}; and __fish_${programName}_needs_positional ${pos.position}`;
    cmd += ` -n '${posCondition}'`;

    // Add value completion based on type
    switch (vc.type) {
      case "choices": {
        const choices = vc.choices?.map((c) => escapeForFish(c)).join(" ") ?? "";
        cmd += ` -f -a "${choices}"`;
        break;
      }
      case "file":
        cmd += " -F";
        break;
      case "directory":
        cmd += " -f -a '(__fish_complete_directories)'";
        break;
      case "command":
        if (vc.shellCommand) {
          cmd += ` -f -a '(${vc.shellCommand} 2>/dev/null)'`;
        }
        break;
    }

    // Add description
    if (includeDescriptions && pos.description) {
      cmd += ` -d '${escapeForFish(pos.description)}'`;
    }

    completions.push(cmd);
  }

  return completions;
}

/**
 * Generate helper functions for fish
 */
function generateHelperFunctions(programName: string): string {
  return `# Helper function to check if using subcommand
function __fish_use_subcommand_${programName}
    set -l cmd (commandline -opc)
    if test (count $cmd) -eq 1
        return 0
    end
    return 1
end

# Helper function to check current subcommand
function __fish_${programName}_using_command
    set -l cmd (commandline -opc)
    if contains -- $argv[1] $cmd
        return 0
    end
    return 1
end

# Helper function to check if we need a positional argument at position N
function __fish_${programName}_needs_positional
    set -l pos $argv[1]
    set -l cmd (commandline -opc)
    set -l positional_count 0

    # Count positional arguments (non-option arguments after the command)
    for i in (seq 2 (count $cmd))
        set -l arg $cmd[$i]
        # Skip options and their values
        if string match -q -- '-*' $arg
            continue
        end
        set positional_count (math $positional_count + 1)
    end

    # Return true if we're at the expected position
    test $positional_count -eq $pos
end
`;
}

/**
 * Recursively generate completions for a command and its subcommands
 */
function generateCommandCompletions(
  command: CompletableSubcommand,
  programName: string,
  includeDescriptions: boolean,
  parentCommands: string[] = [],
): string[] {
  const completions: string[] = [];

  // Build condition for this level
  const optionCondition =
    parentCommands.length === 0
      ? ""
      : `__fish_${programName}_using_command ${parentCommands[parentCommands.length - 1]}`;

  const subcommandCondition =
    parentCommands.length === 0
      ? `__fish_use_subcommand_${programName}`
      : `__fish_${programName}_using_command ${parentCommands[parentCommands.length - 1]}`;

  // Add option completions
  completions.push(
    ...generateOptionCompletions(
      command.options,
      programName,
      optionCondition,
      includeDescriptions,
    ),
  );

  // Add positional completions
  completions.push(
    ...generatePositionalCompletions(
      command.positionals,
      programName,
      parentCommands,
      includeDescriptions,
    ),
  );

  // Add subcommand completions
  if (command.subcommands.length > 0) {
    completions.push(
      ...generateSubcommandCompletions(
        command.subcommands,
        programName,
        subcommandCondition,
        includeDescriptions,
      ),
    );

    // Recursively add completions for subcommands
    for (const sub of command.subcommands) {
      completions.push(
        ...generateCommandCompletions(sub, programName, includeDescriptions, [
          ...parentCommands,
          sub.name,
        ]),
      );
    }
  }

  return completions;
}

/**
 * Generate the fish completion script
 */
function generateFishScript(
  command: CompletableSubcommand,
  programName: string,
  includeDescriptions: boolean,
): string {
  const helpers = generateHelperFunctions(programName);
  const completions = generateCommandCompletions(command, programName, includeDescriptions);

  // Add built-in options (help and version)
  const builtinCompletions = [
    `complete -c ${programName} -l help -s h -d 'Show help information'`,
    `complete -c ${programName} -l version -d 'Show version information'`,
  ];

  return `# Fish completion for ${programName}
# Generated by politty

${helpers}

# Clear existing completions
complete -e -c ${programName}

# Built-in options
${builtinCompletions.join("\n")}

# Command-specific completions
${completions.join("\n")}
`;
}

/**
 * Generate fish completion script for a command
 */
export function generateFishCompletion(
  command: AnyCommand,
  options: CompletionOptions,
): CompletionResult {
  const data = extractCompletionData(command, options.programName);
  const includeDescriptions = options.includeDescriptions ?? true;

  const script = generateFishScript(data.command, options.programName, includeDescriptions);

  return {
    script,
    shell: "fish",
    installInstructions: `# To enable completions, run one of the following:

# Option 1: Source directly
${options.programName} completion fish | source

# Option 2: Save to the fish completions directory
${options.programName} completion fish > ~/.config/fish/completions/${options.programName}.fish

# The completion will be available immediately in new shell sessions.
# To use in the current session, run:
source ~/.config/fish/completions/${options.programName}.fish`,
  };
}

/**
 * Generate dynamic fish completion script that calls __complete command
 */
export function generateDynamicFishScript(programName: string): string {
  return `# Fish dynamic completion for ${programName}
# Generated by politty
# This script calls the CLI to generate completions dynamically

function __fish_${programName}_complete
    # Get current command line arguments
    set -l args (commandline -opc)
    # Remove the program name
    set -e args[1]

    # Call the CLI to get completions
    set -l directive 0

    for line in (${programName} __complete -- $args 2>/dev/null)
        if string match -q ':*' -- $line
            # Parse directive
            set directive (string sub -s 2 -- $line)
        else if test -n "$line"
            # Parse completion: value\\tdescription
            set -l parts (string split \\t -- $line)
            if test (count $parts) -ge 2
                echo $parts[1]\\t$parts[2]
            else
                echo $parts[1]
            end
        end
    end

    # Handle directives by returning special values
    # The main completion function will check for these
    if test (math "$directive & 16") -ne 0
        echo "__directive:file"
    else if test (math "$directive & 32") -ne 0
        echo "__directive:directory"
    end
end

# Clear existing completions
complete -e -c ${programName}

# Main completion
complete -c ${programName} -f -a '(
    set -l completions (__fish_${programName}_complete)
    for c in $completions
        if string match -q "__directive:file" -- $c
            __fish_complete_path
        else if string match -q "__directive:directory" -- $c
            __fish_complete_directories
        else
            echo $c
        end
    end
)'
`;
}
