---
"@politty/core": patch
---

Add `envFile` to `arg()` metadata for global options. The files a marked option names (`envFile: true`, or `"if-exists"` to skip a missing file) are loaded into `process.env` like Node.js `--env-file`, after `--help`/`--version` are recognized and before any `env` fallback is applied. A missing required file fails with a usage error (exit code 2); files given before and after a subcommand are all read, outer first, and variables already set in the environment are kept.
