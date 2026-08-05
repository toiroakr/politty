import { parse as parseYaml } from "yaml";
import type { SkillFrontmatter } from "./types.js";

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
 * A single frontmatter validation problem, in the same `path`/`message`
 * shape the scanner has always rendered into its diagnostics.
 */
export interface FrontmatterIssue {
  path: string[];
  message: string;
}

/**
 * Validate parsed SKILL.md frontmatter against the Agent Skills
 * specification (https://agentskills.io/specification).
 *
 * Validates the spec-defined fields strictly; unknown fields are preserved
 * (passthrough) so spec extensions and vendor keys round-trip intact.
 * Mirrors the deprecated `skillFrontmatterSchema` zod export
 * (frontmatter-schema.ts) — keep the two in sync when the spec changes.
 *
 * Provenance / ownership for politty-managed installs is recorded under
 * `metadata["politty-cli"]` as `"{packageName}:{cliName}"`.
 */
export function validateSkillFrontmatter(
  data: Record<string, unknown>,
): { success: true; data: SkillFrontmatter } | { success: false; issues: FrontmatterIssue[] } {
  const issues: FrontmatterIssue[] = [];

  const checkString = (
    key: string,
    opts: { required?: boolean; min?: number; max?: number },
  ): void => {
    const value = data[key];
    if (value === undefined) {
      if (opts.required) {
        issues.push({ path: [key], message: "Invalid input: expected string, received undefined" });
      }
      return;
    }
    if (typeof value !== "string") {
      issues.push({
        path: [key],
        message: `Invalid input: expected string, received ${typeof value}`,
      });
      return;
    }
    if (opts.min !== undefined && value.length < opts.min) {
      issues.push({
        path: [key],
        message: `Too small: expected string to have >=${opts.min} characters`,
      });
    }
    if (opts.max !== undefined && value.length > opts.max) {
      issues.push({
        path: [key],
        message: `Too big: expected string to have <=${opts.max} characters`,
      });
    }
  };

  checkString("name", { required: true, min: 1, max: NAME_MAX });
  if (typeof data.name === "string" && !SKILL_NAME_PATTERN.test(data.name)) {
    issues.push({
      path: ["name"],
      message: "name must be lowercase alphanumerics separated by single hyphens",
    });
  }
  checkString("description", { required: true, min: 1, max: DESCRIPTION_MAX });
  checkString("license", { min: 1 });
  checkString("compatibility", { max: COMPATIBILITY_MAX });
  checkString("allowed-tools", {});

  const metadata = data.metadata;
  if (metadata !== undefined) {
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
      issues.push({
        path: ["metadata"],
        message: `Invalid input: expected record, received ${metadata === null ? "null" : Array.isArray(metadata) ? "array" : typeof metadata}`,
      });
    } else {
      for (const [key, value] of Object.entries(metadata)) {
        if (typeof value !== "string") {
          issues.push({
            path: ["metadata", key],
            message: `Invalid input: expected string, received ${typeof value}`,
          });
        }
      }
    }
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }
  // Unknown keys pass through untouched, matching the historical
  // z.object(...).passthrough() behavior.
  return { success: true, data: { ...data } as SkillFrontmatter };
}

/**
 * Result of parsing a SKILL.md file.
 */
export interface ParsedSkillMd {
  /** Parsed and validated frontmatter */
  frontmatter: SkillFrontmatter;
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
 * `parseError` is set when the frontmatter fence was present but the YAML
 * inside failed to parse, so the scanner can distinguish "invalid YAML"
 * from "missing required field" in its diagnostics. A non-object root
 * (e.g. a top-level YAML list) also returns empty `data` without
 * `parseError` — schema validation surfaces that case clearly
 * enough on its own.
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
  parseError?: string;
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
  } catch (error) {
    return {
      data: {},
      body,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Root-level plain-object check. Rejects Dates, Maps, and custom tagged types
 * at the root of the parsed YAML; nested values are still validated by the
 * frontmatter validation that consumes this data.
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
  const result = validateSkillFrontmatter(data);

  if (!result.success) {
    return null;
  }

  return {
    frontmatter: result.data,
    body,
    rawContent: content,
  };
}
