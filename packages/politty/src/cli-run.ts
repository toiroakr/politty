/**
 * The real CLI graph behind this package's bin shim.
 *
 * Importing `@politty/zod` registers the zod adapter as a side effect of that
 * package's entry, so the adapter is installed before the politty CLI can
 * dynamically load user command modules carrying zod schemas.
 */

import { runPolittyCli } from "@politty/zod";

// "politty", not "@politty/zod": shims generated through this bin must import
// the cache helper from the package the user actually depends on.
await runPolittyCli("politty");
