---
"politty": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"@politty/valibot": patch
---

Boolean-typed fields now accept the same literal set as Go's `strconv.ParseBool` (`1`/`t`/`T`/`TRUE`/`true`/`True` for true, `0`/`f`/`F`/`FALSE`/`false`/`False` for false) for both `--flag=value` CLI syntax and `env` fallbacks, matching the convention used by Docker, kubectl, Terraform, and GitHub Actions' `RUNNER_DEBUG`. Previously `env` fallbacks applied no coercion at all (a boolean field reading `env: "RUNNER_DEBUG"` would receive the raw string `"1"` and fail validation), and `--flag=value` only recognized `"true"`/`"false"`. Values outside this set are still passed through unchanged so validation reports the invalid input instead of silently guessing.
