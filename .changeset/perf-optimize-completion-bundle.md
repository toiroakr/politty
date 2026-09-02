---
"@politty/valibot": minor
"@politty/zod": minor
"politty": minor
---

Shrink the package entry point by no longer statically bundling the shell-completion generators (bash/zsh/fish, the dynamic `__complete` engine, and the on-disk install/refresh logic) into it. `withCompletionCommand` still works exactly as before, but its `completion`/`__complete`/`__refresh-completion`/`__completion-worker-path` subcommands now load lazily, only when one of them actually runs.

**Breaking:** `generateCompletion` and `generateBundledCompletionWorker` are no longer exported from the package root. Both were already documented as importing from the `/completion` subpath — update any code that imported them from the root instead:

```diff
- import { generateCompletion } from "politty";
+ import { generateCompletion } from "politty/completion";
```

(same for `@politty/zod`/`@politty/valibot`, and for `generateBundledCompletionWorker`). `withCompletionCommand` itself is unaffected — keep importing it from the package root.

Builds are also minified now, cutting total published package size by more than half on top of the entry-point reduction above (`@politty/zod`'s dist JS: 620KB → 269KB).
