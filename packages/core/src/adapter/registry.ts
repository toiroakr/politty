/**
 * Validator adapter registration.
 *
 * `@politty/core` never imports a schema library — the adapter that
 * understands the user's schemas is registered here by the adapter
 * package's entry modules (`@politty/zod`, `@politty/valibot`, ...) as an
 * import-time side effect. Core code that needs to introspect or validate
 * a user schema resolves the current adapter through
 * {@link getValidatorAdapter}.
 */

import type { ValidatorAdapter } from "./types.js";

let registered: ValidatorAdapter | undefined;

/**
 * Register the validator adapter core should use for user schemas.
 * Registration unconditionally replaces the current adapter, so every
 * adapter entry module may call this safely — repeated registration of
 * the same adapter has no observable effect.
 *
 * Single-adapter assumption: the registry holds one adapter per process
 * (last registration wins) — a CLI is built against exactly one schema
 * library. If mixing adapters in one process ever becomes a supported
 * scenario, this needs per-schema vendor dispatch instead.
 */
export function registerValidatorAdapter(adapter: ValidatorAdapter): void {
  registered = adapter;
}

/**
 * Resolve the registered validator adapter.
 *
 * @throws if no adapter has been registered — i.e. core was imported
 * directly instead of through an adapter package entry.
 */
export function getValidatorAdapter(): ValidatorAdapter {
  if (!registered) {
    throw new Error(
      "No validator adapter registered. Import politty through an adapter package " +
        '(e.g. `import { defineCommand } from "@politty/zod"` or `from "politty"`) ' +
        "so the schema library integration is set up.",
    );
  }
  return registered;
}
