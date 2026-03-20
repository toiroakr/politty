import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseSkillMd } from "./frontmatter.js";
import type { DiscoveredSkill } from "./types.js";

const SKILL_MD = "SKILL.md";

/**
 * Scan source directories for SKILL.md files.
 *
 * Each source directory is expected to contain subdirectories,
 * each with a SKILL.md file at its root.
 *
 * @example
 * ```
 * sourceDirs: ["node_modules/@my-agent/skills/skills"]
 *
 * node_modules/@my-agent/skills/skills/
 * ├── commit/
 * │   └── SKILL.md
 * └── review-pr/
 *     └── SKILL.md
 * ```
 */
export function scanSourceDirs(sourceDirs: string[]): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  const seenNames = new Set<string>();

  for (const dir of sourceDirs) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;

    // Check if dir itself has a SKILL.md (single-skill source)
    const directSkill = tryParseSkillDir(dir);
    if (directSkill && !seenNames.has(directSkill.frontmatter.name)) {
      seenNames.add(directSkill.frontmatter.name);
      skills.push(directSkill);
      continue;
    }

    // Scan subdirectories
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = join(dir, entry.name);
      const skill = tryParseSkillDir(skillDir);
      if (skill && !seenNames.has(skill.frontmatter.name)) {
        seenNames.add(skill.frontmatter.name);
        skills.push(skill);
      }
    }
  }

  return skills;
}

function tryParseSkillDir(dir: string): DiscoveredSkill | null {
  const skillMdPath = join(dir, SKILL_MD);
  if (!existsSync(skillMdPath)) return null;

  const content = readFileSync(skillMdPath, "utf-8");
  const parsed = parseSkillMd(content);
  if (!parsed) return null;

  return {
    frontmatter: parsed.frontmatter,
    sourcePath: dir,
    rawContent: content,
  };
}
