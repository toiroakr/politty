/**
 * @politty/zod - politty with zod v4 schemas
 *
 * The user-facing entry point for building politty CLIs with zod: installs
 * the zod validator adapter into `@politty/core` and re-exports the core
 * API (whose public types are written against zod).
 *
 * @packageDocumentation
 */

import "./register.js";

export * from "@politty/core";
