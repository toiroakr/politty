# @politty/zod-mini

## 0.1.3

### Patch Changes

- 60f0d00: chore(deps): update pnpm to v12

## 0.1.2

### Patch Changes

- 783dcc9: Boolean-typed fields now accept the same literal set as Go's `strconv.ParseBool` (`1`/`t`/`T`/`TRUE`/`true`/`True` for true, `0`/`f`/`F`/`FALSE`/`false`/`False` for false) for both `--flag=value` CLI syntax and `env` fallbacks, matching the convention used by Docker, kubectl, Terraform, and GitHub Actions' `RUNNER_DEBUG`. Previously `env` fallbacks applied no coercion at all (a boolean field reading `env: "RUNNER_DEBUG"` would receive the raw string `"1"` and fail validation), and `--flag=value` only recognized `"true"`/`"false"`. Values outside this set are still passed through unchanged so validation reports the invalid input instead of silently guessing.

## 0.1.1

### Patch Changes

- f01148c: Fix `createLogCollector` (used by `executeExamples`/`assertDocMatch`) to also capture output written directly via `process.stdout.write` / `process.stderr.write`, not just `console.*` calls. Previously, a command that printed its primary output with `process.stdout.write` instead of `console.log` was invisible to `examples` verification — that output passed straight through to the real stdout and never showed up in the captured logs.

## 0.1.0

### Minor Changes

- bd9a8db: Add `@politty/zod-mini`: politty with `zod/mini` schemas. The new package exposes the same API surface as `@politty/zod` (`defineCommand`, `arg`, `runMain`, docs/completion/skill/prompt subpaths, and the `politty` bin), backed by a structural zod/mini validator adapter — the same `.def`-based introspection the classic zod adapter uses, with `.isOptional()`/`.description`/`.meta()` (unavailable on `zod/mini`) replaced by `.safeParse(undefined)` and reads from zod's `globalRegistry`. Field metadata comes from `arg()` as well as `.register(z.globalRegistry, {...})`. There is no `@politty/zod-mini/augment` module, matching `@politty/valibot`'s precedent — use `arg()` or the registry instead of the classic-only `GlobalMeta` augmentation.
