import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseSkillMd } from "./frontmatter.js";
import type { DiscoveredSkill } from "./types.js";

const SKILL_MD = "SKILL.md";

/**
 * Scan a source directory for SKILL.md files.
 *
 * The directory is expected to contain subdirectories,
 * each with a SKILL.md file at its root.
 * If the directory itself has a SKILL.md, it is treated as a single-skill source.
 *
 * @example
 * ```
 * sourceDir: "node_modules/@my-agent/skills/skills"
 *
 * node_modules/@my-agent/skills/skills/
 * ├── commit/
 * │   └── SKILL.md
 * └── review-pr/
 *     └── SKILL.md
 * ```
 */
export function scanSourceDir(sourceDir: string): DiscoveredSkill[] {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) return [];

  // Check if dir itself has a SKILL.md (single-skill source)
  const directSkill = tryParseSkillDir(sourceDir);
  if (directSkill) return [directSkill];

  // Scan subdirectories
  const skills: DiscoveredSkill[] = [];
  const entries = readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = join(sourceDir, entry.name);
    const skill = tryParseSkillDir(skillDir);
    if (skill) {
      skills.push(skill);
    }
  }

  skills.sort((a, b) =>
    a.frontmatter.name < b.frontmatter.name ? -1 : a.frontmatter.name > b.frontmatter.name ? 1 : 0,
  );
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
