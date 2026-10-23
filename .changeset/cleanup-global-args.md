---
"@politty/core": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"@politty/valibot": patch
"politty": patch
---

Pass the validated global option values to the global `cleanup` hook as `globalArgs` when a run fails before the global effects have run (an unknown flag, an invalid value, a failed local validation). A `cleanup` that renders the error can now honor a global option such as `--json` without re-reading `process.argv`. Unknown flags are left out, a value that fails its own validation is replaced by its default, and `$source` reports where each value came from; `globalArgs` is `undefined` when a required global value is missing.
