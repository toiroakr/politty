---
"politty": patch
---

Refactor shell completion to thin shell wrappers with `__complete` delegation and fix extension filtering

- Refactor shell scripts (bash/zsh/fish) to thin wrappers that delegate to `__complete --shell={shell}`
- Resolve shellCommand execution and file extension filtering in JS via `@ext:` metadata protocol
- Fix zsh `_files -g` fallback showing all files when no extensions match (file-patterns zstyle)
- Fix bash inline `--opt=value` completion, glob expansion, and stale COMPREPLY
- Fix fish prefix completion bug (`commandline -ct` not always included)
- Add `NoFileCompletion` directive for enum/choices value completions
- Add comprehensive shell completion E2E tests across bash/zsh/fish (zpty, expect, complete --do-complete)
- Split shell completion tests into per-shell vitest projects with CI matrix parallelization
