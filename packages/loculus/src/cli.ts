#!/usr/bin/env node

import { enableCompileCache } from "@politty/core/compile-cache";

enableCompileCache("politty");
await import("./cli-run.js");
