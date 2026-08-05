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
