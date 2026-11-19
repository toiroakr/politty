/**
 * 25-global-options - Global options example
 *
 * Demonstrates runtime global options that are shared across all subcommands.
 *
 * How to run:
 *   pnpx tsx playground/25-global-options/index.ts --help
 *   pnpx tsx playground/25-global-options/index.ts --verbose build --output dist
 *   pnpx tsx playground/25-global-options/index.ts build --verbose --output dist
 *   pnpx tsx playground/25-global-options/index.ts deploy --env staging
 */

import { runMain } from "../../packages/zod/src/index.js";
import { cli, globalArgsSchema } from "./cli.js";

runMain(cli, { version: "1.0.0", globalArgs: globalArgsSchema });
