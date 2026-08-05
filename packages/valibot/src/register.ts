/**
 * Import-time side effect: register the valibot adapter with `@politty/core`.
 *
 * Every entry module of this package imports this file first, so any code
 * path a user can reach has the adapter installed before core touches a
 * schema. Registration is idempotent.
 */

import { registerValidatorAdapter } from "@politty/core/adapter/registry";
import { valibotAdapter } from "./adapter.js";

registerValidatorAdapter(valibotAdapter);
