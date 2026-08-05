/**
 * @politty/valibot - politty with valibot schemas
 *
 * The user-facing entry point for building politty CLIs with valibot:
 * installs the valibot validator adapter into `@politty/core` and
 * re-exports the core API. Core's public types are written against the
 * Standard Schema interface, which valibot schemas satisfy.
 *
 * Unlike `@politty/zod` (which re-pins `ArgsSchema` to the historical
 * zod-typed shape for backwards compatibility), this package keeps core's
 * structural `ArgsSchema` as-is: there is no pre-existing type surface to
 * preserve, and a `GenericSchema<...>`-based alias would reject valid
 * object schemas through `v.object()`'s input-side type parameter variance.
 *
 * @packageDocumentation
 */

import "./register.js";

export * from "@politty/core";
