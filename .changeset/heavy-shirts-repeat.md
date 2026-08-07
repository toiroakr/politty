---
"@politty/zod": minor
"politty": patch
---

Split the repository into a pnpm workspace of three packages:

- `@politty/core` (private): the validator-agnostic framework — parser, runner, help, completion, docs, skill, and prompt layers. It is never published; adapter packages bundle it at build time.
- `@politty/zod` (new): the user-facing package for building politty CLIs with zod v4 schemas. It registers the zod validator adapter on import, re-exports the full core API, and ships the `politty` bin.
- `politty`: now a compatibility alias of `@politty/zod`. Runtime modules re-export `@politty/zod` (so mixing the two packages in one process shares a single adapter registry and arg-metadata store), every existing subpath export (`politty/docs`, `politty/completion`, `politty/skill`, `politty/prompt`, `politty/prompt/clack`, `politty/prompt/inquirer`, `politty/augment`, `politty/compile-cache`) and the `politty` bin keep working, and `declare module "politty"` GlobalArgs augmentation still merges. No API changes for existing users.
