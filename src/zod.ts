/**
 * `politty/zod` — the full politty API with native Zod schema support.
 *
 * Importing this entrypoint registers the Zod adapter (native `_def`
 * introspection + `safeParse` validation), so Zod schemas are introspected
 * synchronously with no extra dependency. Use this instead of bare `politty`
 * when your CLI uses Zod.
 *
 * @example
 * ```ts
 * import { defineCommand, runMain, arg } from "politty/zod";
 * import { z } from "zod";
 * ```
 */

import { zodAdapter } from "./adapters/zod.js";
import { registerSchemaAdapter } from "./core/schema-registry.js";

export * from "./index.js";
// Zod-specific introspection helpers (moved off the core barrel).
export { extractEnumValues, getUnknownKeysMode } from "./adapters/zod.js";

registerSchemaAdapter(zodAdapter);
