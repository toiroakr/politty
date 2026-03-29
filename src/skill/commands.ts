import { execFileSync } from "node:child_process";
import { z } from "zod";
import { arg } from "../core/arg-registry.js";
import { defineCommand } from "../core/command.js";
import { logger, symbols } from "../output/logger.js";
import { scanSourceDir } from "./scanner.js";
import type { DiscoveredSkill, SkillCommandOptions } from "./types.js";

function getSkills(options: SkillCommandOptions): DiscoveredSkill[] {
  return scanSourceDir(options.sourceDir);
}

/**
 * Create the `skills sync` subcommand.
 *
 * Removes and reinstalls all skills discovered in sourceDir.
 * Skills previously installed but no longer in sourceDir are not affected.
 */
export function createSkillSyncCommand(options: SkillCommandOptions) {
  return defineCommand({
    name: "sync",
    description: "Remove and reinstall all skills from source",
    args: z.object({
      exclude: arg(z.array(z.string()).default([]), {
        alias: "e",
        description: "Skill names to exclude from sync",
      }),
    }),
    run(args) {
      const allSkills = getSkills(options);

      if (allSkills.length === 0) {
        logger.info("No skills found in source directory.");
        return;
      }

      const excluded = new Set(args.exclude);
      const skills = allSkills.filter((s) => !excluded.has(s.frontmatter.name));

      // Remove all (non-excluded), tracking failures
      const failedRemoves = new Set<string>();
      for (const skill of skills) {
        if (!removeSkill(skill.frontmatter.name)) {
          failedRemoves.add(skill.frontmatter.name);
        }
      }

      // Add all (non-excluded), skipping skills that failed to remove
      for (const skill of skills) {
        if (failedRemoves.has(skill.frontmatter.name)) {
          logger.warn(`Skipping install of ${skill.frontmatter.name} (removal failed)`);
          continue;
        }
        addSkill(skill);
      }
    },
  });
}

/**
 * Create the `skills add` subcommand.
 *
 * Discovers skills from sourceDir and delegates installation
 * to `npx skills add <local-path>`.
 */
export function createSkillAddCommand(options: SkillCommandOptions) {
  return defineCommand({
    name: "add",
    description: "Install skills from source package",
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
      if (args.all && args.name) {
        logger.error("Specify either a skill name or --all, not both.");
        process.exitCode = 1;
        return;
      }

      const sourceSkills = getSkills(options);

      if (sourceSkills.length === 0) {
        logger.info("No skills found in source directory.");
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

      const skill = findSkill(sourceSkills, args.name);
      if (!skill) return;

      addSkill(skill);
    },
  });
}

/**
 * Create the `skills remove` subcommand.
 *
 * Only skills provided by this CLI's sourceDir can be removed.
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
      if (args.all && args.name) {
        logger.error("Specify either a skill name or --all, not both.");
        process.exitCode = 1;
        return;
      }

      const sourceSkills = getSkills(options);

      if (sourceSkills.length === 0) {
        logger.info("No skills found in source directory.");
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

      const skill = findSkill(sourceSkills, args.name);
      if (!skill) return;

      removeSkill(skill.frontmatter.name);
    },
  });
}

/**
 * Create the `skills list` subcommand.
 *
 * Lists available skills from the source directory.
 */
export function createSkillListCommand(options: SkillCommandOptions) {
  return defineCommand({
    name: "list",
    description: "List available skills from source package",
    args: z.object({
      json: arg(z.boolean().default(false), {
        description: "Output as JSON",
      }),
    }),
    run(args) {
      const sourceSkills = getSkills(options);

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
        logger.info("No skills found in source directory.");
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

function findSkill(skills: DiscoveredSkill[], name: string): DiscoveredSkill | undefined {
  const skill = skills.find((s) => s.frontmatter.name === name);
  if (!skill) {
    logger.error(`Skill "${name}" not found in source directory.`);
    logger.info(`Available: ${skills.map((s) => s.frontmatter.name).join(", ")}`);
    process.exitCode = 1;
  }
  return skill;
}

function addSkill(skill: DiscoveredSkill): boolean {
  logger.info(`Installing ${skill.frontmatter.name}...`);
  try {
    execFileSync("npx", ["--yes", "skills", "add", skill.sourcePath], {
      stdio: "inherit",
    });
    logger.info(`${symbols.success} Installed ${skill.frontmatter.name}`);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to install ${skill.frontmatter.name}: ${reason}`);
    process.exitCode = 1;
    return false;
  }
}

function removeSkill(name: string): boolean {
  try {
    execFileSync("npx", ["--yes", "skills", "remove", name], {
      stdio: "inherit",
    });
    logger.info(`${symbols.success} Removed ${name}`);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to remove ${name}: ${reason}`);
    process.exitCode = 1;
    return false;
  }
}
