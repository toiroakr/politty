import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Skill name pattern from the Agent Skills specification:
 * https://agentskills.io/specification
 *
 * Lowercase alphanumerics separated by single hyphens, no leading/trailing
 * hyphen. Also used as the skill directory name; enforced again at scan time
 * to match the containing directory name.
 */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Max lengths come from the Agent Skills specification.
 */
const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const COMPATIBILITY_MAX = 500;

/**
 * Zod schema for SKILL.md frontmatter.
 *
 * Strictly validates the fields defined in the Agent Skills specification
 * (https://agentskills.io/specification). Unknown fields are preserved via
 * `.passthrough()` so spec extensions and vendor keys round-trip intact.
 *
 * Provenance / ownership for politty-managed installs is recorded under
 * `metadata["politty-cli"]` as `"{packageName}:{cliName}"`.
 */
export const skillFrontmatterSchema = z
  .object({
    /** Skill identifier. Lowercase alphanumerics + hyphens, 1..64 chars. */
    name: z.string().min(1).max(NAME_MAX).regex(SKILL_NAME_PATTERN, {
      message: "name must be lowercase alphanumerics separated by single hyphens",
    }),
    /** Human-readable description (1..1024 chars). */
    description: z.string().min(1).max(DESCRIPTION_MAX),
    /** SPDX license identifier or free-form string. */
    license: z.string().min(1).optional(),
    /** Runtime / tool compatibility string (<=500 chars). */
    compatibility: z.string().max(COMPATIBILITY_MAX).optional(),
    /** Metadata map (spec: string keys, string values). */
    metadata: z.record(z.string(), z.string()).optional(),
    /** Experimental spec field. */
    "allowed-tools": z.string().optional(),
  })
  .passthrough();

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
 * Matches a YAML frontmatter block. The leading `\uFEFF?` tolerates a UTF-8
 * byte-order mark that some editors prepend to saved files.
 */
const FRONTMATTER_PATTERN = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

/**
 * Parse YAML frontmatter from a SKILL.md string.
 *
 * @example
 * ```typescript
 * const result = parseFrontmatter(`---
 * name: commit
 * description: Git commit message generation
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
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { data: {}, body: content };
  }

  const yamlBlock = match[1]!;
  const body = match[2]!;

  try {
    const data = parseYaml(yamlBlock);
    if (!isPlainObject(data)) {
      return { data: {}, body };
    }
    return { data, body };
  } catch {
    return { data: {}, body };
  }
}

/**
 * Root-level plain-object check. Rejects Dates, Maps, and custom tagged types
 * at the root of the parsed YAML; nested values are still validated by the
 * Zod schema that consumes this data.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Parse and validate a SKILL.md content string.
 *
 * @returns Parsed skill metadata and body, or `null` if the frontmatter is
 *   missing or fails schema validation.
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
