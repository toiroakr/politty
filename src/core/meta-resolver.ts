/**
 * Re-export from schema-extractor for backwards compatibility
 * @module
 */
export type { ResolvedFieldMeta as ResolvedArgMeta } from "./schema-extractor.js";

// Note: The old resolveArgMeta function is no longer needed.
// Use extractFields from schema-extractor instead.
// This module is kept for backwards compatibility during migration.
