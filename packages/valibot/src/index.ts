/**
 * @politty/valibot - politty with valibot schemas
 *
 * The user-facing entry point for building politty CLIs with valibot:
 * installs the valibot validator adapter into `@politty/core` and
 * re-exports the core API. Core's public types are written against the
 * Standard Schema interface, which valibot schemas satisfy.
 *
 * @packageDocumentation
 */

import "./register.js";

export * from "@politty/core";
