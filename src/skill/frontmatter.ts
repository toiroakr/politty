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
 * Supports a minimal subset of YAML sufficient for SKILL.md:
 * - String values (plain and quoted)
 * - Nested objects (one level, via dot-path or indentation)
 * - Boolean/null values
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
  const data: Record<string, unknown> = {};

  let currentKey: string | null = null;
  let currentObject: Record<string, unknown> | null = null;

  for (const line of yamlBlock.split("\n")) {
    // Skip empty lines and comments
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;

    // Check for indented key (nested object)
    const indentedMatch = line.match(/^[ \t]+(\w[\w-]*):\s*(.*)$/);
    if (indentedMatch && currentKey && currentObject) {
      const key = indentedMatch[1]!;
      const rawVal = indentedMatch[2]!;
      currentObject[key] = parseYamlValue(rawVal.trim());
      data[currentKey] = currentObject;
      continue;
    }

    // Top-level key: value
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1]!;
      const value = kvMatch[2]!.trim();

      if (value === "") {
        // Start of a nested object
        currentKey = key;
        currentObject = {};
        data[key] = currentObject;
      } else {
        currentKey = null;
        currentObject = null;
        data[key] = parseYamlValue(value);
      }
    }
  }

  return { data, body };
}

/**
 * Parse a single YAML value (minimal subset).
 */
function parseYamlValue(raw: string): unknown {
  if (raw === "" || raw === "~" || raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  // Flow-style array: [a, b, c]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => parseYamlValue(item.trim()));
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }

  return raw;
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
