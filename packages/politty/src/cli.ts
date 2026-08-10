#!/usr/bin/env node

/**
 * Bin shim for the `politty` bin of this compatibility alias.
 *
 * Cannot simply re-run `@politty/zod`'s CLI: the CLI bakes the name of the
 * package running it into the shims `generate-shim` writes, and for a CLI
 * depending on `politty` alone that name has to be `politty` — under a strict
 * node_modules layout (pnpm) its own package cannot resolve `@politty/zod`.
 *
 * Mirrors `@politty/zod`'s entry otherwise: enable the on-disk V8 compile
 * cache before the real CLI graph is compiled, then load that graph through a
 * dynamic import so it is what the cache covers.
 */

import { enableCompileCache } from "@politty/zod/compile-cache";

enableCompileCache("politty");
await import("./cli-run.js");
