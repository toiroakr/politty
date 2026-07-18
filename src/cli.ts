#!/usr/bin/env node

/**
 * Bin shim: enable the on-disk V8 compile cache before the real CLI graph
 * is compiled, so warm starts skip recompilation (Node >= 22.8.0; no-op
 * otherwise). The actual CLI lives in `cli-main.ts` and is loaded via
 * dynamic import — ESM static imports are compiled during the link phase,
 * before any code runs, so they could never hit a cache enabled here.
 */

import { enableCompileCache } from "./compile-cache.js";

enableCompileCache("politty");
await import("./cli-main.js");
