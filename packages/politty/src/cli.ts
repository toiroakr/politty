#!/usr/bin/env node

/**
 * Compatibility alias of the `politty` bin: delegates to `@politty/zod`'s
 * CLI entry (which enables the compile cache itself before loading the
 * real CLI graph).
 */

import "@politty/zod/cli";
