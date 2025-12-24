/**
 * This module augments Zod's ZodTypeDef to support ArgMeta in the global registry.
 * Import this file to enable storing arg metadata directly on Zod schemas.
 *
 * @example
 * ```ts
 * import "politty/augment";
 * import { z } from "zod";
 *
 * const schema = z.string().describe("User name");
 * // Now ArgMeta can be stored in Zod's global registry
 * ```
 */

import type { ArgMeta } from "./core/arg-registry.js";

declare module "zod" {
  interface ZodTypeDef {
    argMeta?: ArgMeta;
  }
}

// This file has no runtime code, it only provides type augmentation
export {};
