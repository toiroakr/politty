import { z } from "zod";

/**
 * Zod schema for SKILL.md frontmatter.
 *
 * @deprecated Kept as a public export of `politty/skill` for backwards
 * compatibility. politty itself no longer validates frontmatter through
 * this schema — see `validateSkillFrontmatter` in `frontmatter.ts`, which
 * implements the same Agent Skills specification rules without a runtime
 * zod dependency. Keep the two in sync when the spec changes.
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
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
        message: "name must be lowercase alphanumerics separated by single hyphens",
      }),
    /** Human-readable description (1..1024 chars). */
    description: z.string().min(1).max(1024),
    /** SPDX license identifier or free-form string. */
    license: z.string().min(1).optional(),
    /** Runtime / tool compatibility string (<=500 chars). */
    compatibility: z.string().max(500).optional(),
    /** Metadata map (spec: string keys, string values). */
    metadata: z.record(z.string(), z.string()).optional(),
    /** Experimental spec field. */
    "allowed-tools": z.string().optional(),
  })
  .passthrough();
