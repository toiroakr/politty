import { registerValidatorAdapter } from "@politty/core/adapter/registry";
import { loculusAdapter } from "./adapter.js";
registerValidatorAdapter(loculusAdapter);
