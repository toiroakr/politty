/**
 * Test setup: register the native Zod and Valibot adapters globally.
 *
 * The bare `politty` entrypoint registers only the internal adapter and the
 * generic Standard Schema fallback; real users opt into native introspection by
 * importing `politty/zod` / `politty/valibot`. The test suite uses Zod and
 * Valibot schemas directly via `politty`, so we register both natively here —
 * mirroring what those users' imports do — to keep synchronous introspection
 * working and to exercise the native adapters.
 */

import { valibotAdapter } from "../src/adapters/valibot.js";
import { zodAdapter } from "../src/adapters/zod.js";
import { registerSchemaAdapter } from "../src/core/schema-registry.js";

registerSchemaAdapter(zodAdapter);
registerSchemaAdapter(valibotAdapter);
