import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Zod schema for SKILL.md frontmatter.
 *
 * Compatible with vercel-labs/skills format, extended with `package` field.
 */
export const skillFrontmatterSchema = z.object({
  /** Skill identifier */
  name: z.string(),
  /** Human-readable description */
  description: z.string(),
  /** npm package this skill originated from (for provenance tracking) */
  package: z.string().optional(),
  /** Additional metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Result of parsing a SKILL.md file.
 */
export interface ParsedSkillMd {
  /** Parsed and validated frontmatter */
  frontmatter: z.infer<typeof skillFrontmatterSchema>;
  /** Markdown body (content after frontmatter) */
  body: string;
  /** Full raw content */
  rawContent: string;
}

/**
 * Parse YAML frontmatter from a SKILL.md string.
 *
 * Extracts the YAML block between `---` delimiters and parses it
 * using the `yaml` package.
 *
 * @example
 * ```typescript
 * const result = parseFrontmatter(`---
 * name: commit
 * description: Git commit message generation
 * package: "@my-agent/skills"
 * ---
 * # Instructions...`);
 *
 * result.data.name; // "commit"
 * ```
 */
export function parseFrontmatter(content: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: content };
  }

  const yamlBlock = match[1]!;
  const body = match[2]!;

  try {
    const data = parseYaml(yamlBlock);
    if (data == null || typeof data !== "object" || Array.isArray(data)) {
      return { data: {}, body };
    }
    return { data: data as Record<string, unknown>, body };
  } catch {
    return { data: {}, body };
  }
}

/**
 * Parse and validate a SKILL.md content string.
 *
 * @returns Parsed skill metadata and body, or null if invalid.
 */
export function parseSkillMd(content: string): ParsedSkillMd | null {
  const { data, body } = parseFrontmatter(content);
  const result = skillFrontmatterSchema.safeParse(data);

  if (!result.success) {
    return null;
  }

  return {
    frontmatter: result.data,
    body,
    rawContent: content,
  };
}
