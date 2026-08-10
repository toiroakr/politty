/**
 * politty - A lightweight CLI framework with zod v4 registry integration
 *
 * Compatibility alias of `@politty/zod`: every export re-exported here is
 * the same runtime object, so mixing `politty` and `@politty/zod` imports
 * in one process keeps a single adapter registry / arg-metadata store.
 *
 * @packageDocumentation
 */

export * from "@politty/zod";

import { createCompileCacheShimGenerator } from "@politty/zod";

/**
 * Generate compile-cache bin shims that import the cache helper from
 * `politty/compile-cache`.
 *
 * Overrides `@politty/zod`'s binding of the same name — the one thing this
 * alias cannot re-export as-is. A CLI depending on `politty` alone cannot
 * resolve `@politty/zod` from its own package under a strict node_modules
 * layout (pnpm), so a shim naming it would silently lose the compile cache.
 */
export const generateCompileCacheShim = createCompileCacheShimGenerator("politty");
