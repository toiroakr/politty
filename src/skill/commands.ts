import { execFileSync } from "node:child_process";
import { z } from "zod";
import { arg } from "../core/arg-registry.js";
import { defineCommand } from "../core/command.js";
import { logger, symbols } from "../output/logger.js";
import { scanSourceDir } from "./scanner.js";
import type { DiscoveredSkill, SkillCommandOptions } from "./types.js";

/**
 * Create the `skill add` subcommand.
 *
 * Discovers skills from sourceDirs and delegates installation
 * to `npx skills add <local-path>`.
 */
export function createSkillAddCommand(options: SkillCommandOptions) {
  return defineCommand({
    name: "add",
    description: "Install skills from source packages",
    args: z.object({
      name: arg(z.string().optional(), {
        positional: true,
        description: "Skill name to install",
        placeholder: "NAME",
      }),
      all: arg(z.boolean().default(false), {
        description: "Install all available skills",
      }),
    }),
    run(args) {
      const sourceSkills = scanSourceDir(options.sourceDir);

      if (sourceSkills.length === 0) {
        logger.info("No skills found in source directories.");
        return;
      }

      if (args.all) {
        for (const skill of sourceSkills) {
          addSkill(skill);
        }
        return;
      }

      if (!args.name) {
        logger.error("Specify a skill name or use --all.");
        process.exitCode = 1;
        return;
      }

      const skill = sourceSkills.find((s) => s.frontmatter.name === args.name);
      if (!skill) {
        logger.error(`Skill "${args.name}" not found in source directories.`);
        logger.info(`Available: ${sourceSkills.map((s) => s.frontmatter.name).join(", ")}`);
        process.exitCode = 1;
        return;
      }

      addSkill(skill);
    },
  });
}

/**
 * Create the `skill remove` subcommand.
 *
 * Only skills provided by this CLI's sourceDirs can be removed.
 * Delegates actual removal to `npx skills remove <name>`.
 */
export function createSkillRemoveCommand(options: SkillCommandOptions) {
  return defineCommand({
    name: "remove",
    description: "Remove installed skills",
    args: z.object({
      name: arg(z.string().optional(), {
        positional: true,
        description: "Skill name to remove",
        placeholder: "NAME",
      }),
      all: arg(z.boolean().default(false), {
        description: "Remove all skills provided by this CLI",
      }),
    }),
    run(args) {
      const sourceSkills = scanSourceDir(options.sourceDir);

      if (sourceSkills.length === 0) {
        logger.info("No skills found in source directories.");
        return;
      }

      if (args.all) {
        for (const skill of sourceSkills) {
          removeSkill(skill.frontmatter.name);
        }
        return;
      }

      if (!args.name) {
        logger.error("Specify a skill name or use --all.");
        process.exitCode = 1;
        return;
      }

      const skill = sourceSkills.find((s) => s.frontmatter.name === args.name);
      if (!skill) {
        logger.error(`Skill "${args.name}" not found in source directories.`);
        logger.info(`Available: ${sourceSkills.map((s) => s.frontmatter.name).join(", ")}`);
        process.exitCode = 1;
        return;
      }

      removeSkill(skill.frontmatter.name);
    },
  });
}

/**
 * Create the `skill list` subcommand.
 *
 * Lists available skills from source directories.
 */
export function createSkillListCommand(options: SkillCommandOptions) {
  return defineCommand({
    name: "list",
    description: "List available skills from source packages",
    args: z.object({
      json: arg(z.boolean().default(false), {
        description: "Output as JSON",
      }),
    }),
    run(args) {
      const sourceSkills = scanSourceDir(options.sourceDir);

      if (args.json) {
        console.log(
          JSON.stringify(
            sourceSkills.map((s) => ({
              name: s.frontmatter.name,
              description: s.frontmatter.description,
              package: s.frontmatter.package,
              sourcePath: s.sourcePath,
            })),
          ),
        );
        return;
      }

      if (sourceSkills.length === 0) {
        logger.info("No skills found in source directories.");
        return;
      }

      logger.info("Available skills:");
      for (const skill of sourceSkills) {
        const pkg = skill.frontmatter.package ? ` (${skill.frontmatter.package})` : "";
        logger.info(
          `  ${skill.frontmatter.name.padEnd(20)} ${skill.frontmatter.description}${pkg}`,
        );
      }
    },
  });
}

function addSkill(skill: DiscoveredSkill): void {
  logger.info(`Installing ${skill.frontmatter.name} from ${skill.sourcePath}...`);
  try {
    execFileSync("npx", ["skills", "add", skill.sourcePath], {
      stdio: "inherit",
    });
    logger.info(`${symbols.success} Installed ${skill.frontmatter.name}`);
  } catch {
    logger.error(`Failed to install ${skill.frontmatter.name}`);
    process.exitCode = 1;
  }
}

function removeSkill(name: string): void {
  try {
    execFileSync("npx", ["skills", "remove", name], {
      stdio: "inherit",
    });
    logger.info(`${symbols.success} Removed ${name}`);
  } catch {
    logger.error(`Failed to remove ${name}`);
    process.exitCode = 1;
  }
}
