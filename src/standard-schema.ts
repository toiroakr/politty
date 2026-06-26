/**
 * `politty/standard-schema` — the full politty API with the generic Standard
 * Schema adapter, which introspects any Standard Schema library (ArkType,
 * Valibot, ...) by converting it to JSON Schema via the optional
 * `@standard-community/standard-json` package (plus the vendor converter).
 *
 * The generic adapter is also bundled into bare `politty` as the fallback, so
 * importing this entrypoint is equivalent to importing `politty` — it exists
 * for naming symmetry with `politty/zod` and `politty/valibot`, and as the
 * explicit home of the JSON-Schema-based path for non-native vendors.
 *
 * @example
 * ```ts
 * import { defineCommand, runMain, arg } from "politty/standard-schema";
 * import { type } from "arktype";
 * ```
 */

export * from "./index.js";
