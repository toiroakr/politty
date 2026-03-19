import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveredSkill, InstalledSkill, SyncResult } from "./types.js";

const SKILL_MD = "SKILL.md";
const DEFAULT_INSTALL_DIR = ".agents/skills";

/**
 * Sync skills from source directories to the project.
 *
 * - Installs new skills that exist in source but not installed
 * - Updates skills whose content has changed
 * - Detects and removes skills that no longer exist in the source
 *   (matched by `package` frontmatter field)
 *
 * @param sourceSkills - Skills discovered from source directories
 * @param installDir - Target installation directory (defaults to `.agents/skills`)
 * @param installedSkills - Currently installed skills
 */
export function syncSkills(
  sourceSkills: DiscoveredSkill[],
  installedSkills: InstalledSkill[],
  installDir = DEFAULT_INSTALL_DIR,
): SyncResult {
  const result: SyncResult = {
    installed: [],
    removed: [],
    unchanged: [],
    updated: [],
  };

  const installedByName = new Map(installedSkills.map((s) => [s.frontmatter.name, s]));
  const sourceByName = new Map(sourceSkills.map((s) => [s.frontmatter.name, s]));

  // Install or update source skills
  for (const source of sourceSkills) {
    const installed = installedByName.get(source.frontmatter.name);

    if (!installed) {
      // New skill — install
      installSkillToDir(source, installDir);
      result.installed.push(source);
    } else {
      // Existing — check if content changed
      const installedContent = readInstalledContent(installed.installedPath);
      if (installedContent !== source.rawContent) {
        installSkillToDir(source, installDir);
        result.updated.push(source);
      } else {
        result.unchanged.push(source);
      }
    }
  }

  // Detect removed skills: installed skills whose package matches a source package
  // but whose name no longer appears in the source
  const sourcePackages = new Set(
    sourceSkills.filter((s) => s.frontmatter.package).map((s) => s.frontmatter.package),
  );

  for (const installed of installedSkills) {
    const pkg = installed.frontmatter.package;
    if (!pkg || !sourcePackages.has(pkg)) continue;

    if (!sourceByName.has(installed.frontmatter.name)) {
      // This skill's package still exists in source, but the skill itself was removed
      rmSync(installed.installedPath, { recursive: true, force: true });
      result.removed.push(installed);
    }
  }

  return result;
}

function installSkillToDir(skill: DiscoveredSkill, installDir: string): void {
  const destDir = join(installDir, skill.frontmatter.name);
  mkdirSync(destDir, { recursive: true });
  cpSync(skill.sourcePath, destDir, { recursive: true });
}

function readInstalledContent(installedPath: string): string | null {
  const skillMdPath = join(installedPath, SKILL_MD);
  if (!existsSync(skillMdPath)) return null;
  return readFileSync(skillMdPath, "utf-8");
}
