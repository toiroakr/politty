---
"politty": minor
---

Add runtime dispatcher shell completion with fast static-worker paths.

The default `completion <shell>` output now resolves the active CLI executable at completion time and uses bundled or cached static workers for fast bash, zsh, and fish completions. This keeps project-local binaries working with tools such as `direnv`, `mise`, and `node_modules/.bin`, while avoiding a JavaScript process on common warm completion paths.

Politty-based CLIs can generate bundled workers with `generateBundledCompletionWorker()` from `politty/completion` or the `politty generate-worker` package-script CLI.

Existing users:

- Existing `eval "$(mycli completion bash)"` and `eval "$(mycli completion zsh)"` setup keeps working and now uses dispatcher mode by default.
- Existing fish users can rerun `mycli completion fish --install` after upgrading to refresh the fish autoload file.
- If you saved a generated static completion script and want the new dispatcher behavior, regenerate it with `mycli completion <shell>`.
- If you prefer the previous command-tree script that does not resolve the active binary at TAB time, use `mycli completion <shell> --static`.

New users:

- Use `mycli completion bash`, `mycli completion zsh`, or `mycli completion fish --install` for the default dispatcher setup.
- For published CLIs, generate and ship a bundled worker artifact with `politty generate-worker --bin dist/cli/index.mjs --program mycli --shell zsh --verify` to avoid first-TAB worker generation.
- For package layouts that cannot be represented with package-relative worker paths, enable `bundledWorker.queryCommand` so the dispatcher can ask the CLI for `__completion-worker-path <shell>` on the miss path.
