/**
 * Vitest setup: install the zod validator adapter into `@politty/core`.
 *
 * Tests that exercise core modules directly (parser, schema extraction,
 * runner, ...) with zod fixture schemas never import an `@politty/zod`
 * entry module, so the import-time registration that adapter entries
 * perform for real users has to happen here instead.
 */

import "../../packages/zod/src/register.js";
