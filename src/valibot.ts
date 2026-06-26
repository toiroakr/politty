/**
 * `politty/valibot` — the full politty API with native Valibot schema support.
 *
 * Importing this entrypoint registers the native Valibot adapter, which reads
 * Valibot's internal structure directly. Valibot schemas are then introspected
 * synchronously and with no extra dependency (just `valibot`) — no
 * `@standard-community/standard-json` / `@valibot/to-json-schema` required.
 *
 * @example
 * ```ts
 * import { defineCommand, runMain, arg } from "politty/valibot";
 * import * as v from "valibot";
 * ```
 */

import { valibotAdapter } from "./adapters/valibot.js";
import { registerSchemaAdapter } from "./core/schema-registry.js";

export * from "./index.js";

registerSchemaAdapter(valibotAdapter);
