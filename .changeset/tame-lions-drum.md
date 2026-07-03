---
"politty": patch
---

Add the missing MIT LICENSE file (the package has declared `"license": "MIT"` without shipping the license text). Also remove the stale `package-lock.json` that had been accidentally committed to this pnpm-managed project, and pin the `pkg-pr-new` preview-publish tool to an exact version instead of running `pnpm dlx`'s latest unconditionally in a `pull-requests: write` job.
