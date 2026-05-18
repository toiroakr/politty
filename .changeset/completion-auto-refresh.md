---
"politty": patch
---

Add auto-refresh for shell completion caches.

Generated bash/zsh/fish scripts now embed a `# politty-bin-sig: <mtime>` header. The cache is regenerated automatically through two complementary paths:

- A small rc-loader snippet (printed by `<program> completion <shell> --loader`) that bash/zsh source on every shell startup. It compares the binary's mtime against the cache header and rewrites the cache when they differ before sourcing it.
- A detached `__refresh-completion` child that `runMain` spawns on every CLI invocation, keeping caches warm even when shells aren't restarted.

For fish, the autoload file written by `<program> completion fish --install` ends with a self-rewriting block that runs on TAB and replaces itself when stale.

New `--install` and `--loader` flags on the `completion` subcommand. New `WithCompletionOptions.cacheDir` and `WithCompletionOptions.programVersion`. Set `POLITTY_NO_COMPLETION_REFRESH=1` to disable the runMain background hook.
