---
"politty": patch
---

Point `bin` at a committed `bin/cli.mjs` launcher instead of `dist/cli.js`. pnpm only symlinks a `bin` whose target exists at install time, so a clean checkout of a workspace consuming politty via `workspace:` had no `dist/` yet and silently never got a `node_modules/.bin/politty` link (pnpm/pnpm#10524, #6221, #5570). npm package consumers are unaffected.
