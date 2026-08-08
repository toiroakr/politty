/**
 * The real CLI graph behind the bin shim. The zod adapter must be
 * registered before `@politty/core/cli-main` runs the politty CLI (whose
 * subcommands can dynamically load user command modules with zod schemas),
 * so cli-main is loaded via dynamic import — a static import pair could be
 * reordered by import-sorting tooling.
 */

import "./register.js";

const { runPolittyCli } = await import("@politty/core/cli-main");

// This package's name reaches `generate-shim` here, so a generated shim
// imports the cache helper from the package that produced it.
await runPolittyCli("@politty/zod");
