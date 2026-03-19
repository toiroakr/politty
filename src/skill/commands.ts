import { z } from "zod";
import { arg } from "../core/arg-registry.js";
import { defineCommand } from "../core/command.js";
import { logger, symbols } from "../output/logger.js";
import { scanInstalledSkills, scanSourceDirs } from "./scanner.js";
import { syncSkills } from "./sync.js";
import type { SkillCommandOptions, SkillFrontmatter } from "./types.js";

const DEFAULT_INSTALL_DIR = ".agents/skills";

export function createSkillSyncCommand(options: SkillCommandOptions) {
  return defineCommand({
    name: "sync",
    description: "Sync skills from source packages to the project",
    args: z.object({
      force: arg(z.boolean().default(false), {
        alias: "f",
        description: "Force overwrite all skills",
      }),
    }),
    async run(args) {
      const sourceSkills = scanSourceDirs(options.sourceDirs);

      if (sourceSkills.length === 0) {
        logger.info("No skills found in source directories.");
        return;
      }

      const installed = scanInstalledSkills(DEFAULT_INSTALL_DIR);

      const result = args.force
        ? syncSkills(sourceSkills, [], DEFAULT_INSTALL_DIR)
        : syncSkills(sourceSkills, installed, DEFAULT_INSTALL_DIR);

      for (const skill of result.installed) {
        logger.info(`${symbols.success} Installed ${skill.frontmatter.name}`);
      }
      for (const skill of result.updated) {
        logger.info(`${symbols.success} Updated ${skill.frontmatter.name}`);
      }
      for (const skill of result.removed) {
        logger.info(`${symbols.success} Removed ${skill.frontmatter.name}`);
      }
      for (const skill of result.unchanged) {
        logger.info(`  ${skill.frontmatter.name} is up to date`);
      }

      const total = result.installed.length + result.updated.length + result.removed.length;
      if (total === 0) {
        logger.info("All skills are up to date.");
      }

      await options.onSync?.(result);
    },
  });
}

export function createSkillListCommand(options: SkillCommandOptions) {
  return defineCommand({
    name: "list",
    description: "List installed and available skills",
    args: z.object({
      available: arg(z.boolean().default(false), {
        alias: "a",
        description: "Show available skills from source directories",
      }),
      json: arg(z.boolean().default(false), {
        description: "Output as JSON",
      }),
    }),
    run(args) {
      const installed = scanInstalledSkills(DEFAULT_INSTALL_DIR);

      if (args.available) {
        const source = scanSourceDirs(options.sourceDirs);
        const installedNames = new Set(installed.map((s) => s.frontmatter.name));

        if (args.json) {
          console.log(
            JSON.stringify({
              installed: installed.map(formatSkillJson),
              available: source
                .filter((s) => !installedNames.has(s.frontmatter.name))
                .map(formatSkillJson),
            }),
          );
          return;
        }

        if (installed.length > 0) {
          logger.info("Installed:");
          for (const skill of installed) {
            printSkill(skill.frontmatter);
          }
        }

        const notInstalled = source.filter((s) => !installedNames.has(s.frontmatter.name));
        if (notInstalled.length > 0) {
          if (installed.length > 0) logger.info("");
          logger.info("Available:");
          for (const skill of notInstalled) {
            printSkill(skill.frontmatter);
          }
        }

        if (installed.length === 0 && notInstalled.length === 0) {
          logger.info("No skills found.");
        }
        return;
      }

      if (args.json) {
        console.log(JSON.stringify(installed.map(formatSkillJson)));
        return;
      }

      if (installed.length === 0) {
        logger.info("No skills installed.");
        return;
      }

      logger.info("Installed skills:");
      for (const skill of installed) {
        printSkill(skill.frontmatter);
      }
    },
  });
}

function printSkill(fm: SkillFrontmatter) {
  const pkg = fm.package ? ` (${fm.package})` : "";
  logger.info(`  ${fm.name.padEnd(20)} ${fm.description}${pkg}`);
}

function formatSkillJson(skill: { frontmatter: SkillFrontmatter }) {
  return {
    name: skill.frontmatter.name,
    description: skill.frontmatter.description,
    package: skill.frontmatter.package,
  };
}
