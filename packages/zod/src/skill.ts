import "./register.js";

export * from "@politty/core/skill";
// Deprecated zod-based schema, kept for backwards compatibility only —
// politty validates frontmatter without zod (see core's skill/frontmatter.ts).
export { skillFrontmatterSchema } from "./skill-frontmatter-schema.js";
