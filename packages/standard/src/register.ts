import { registerValidatorAdapter } from "@politty/core/adapter/registry";
import { standardAdapter } from "./adapter.js";

registerValidatorAdapter(standardAdapter);
