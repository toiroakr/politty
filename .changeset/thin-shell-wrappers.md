---
"politty": patch
---

Refactor shell completion to thin shell wrappers with `__complete` delegation and fix extension filtering

- Refactor shell scripts (bash/zsh/fish) to thin wrappers that delegate to `__complete --shell={shell}`
- Resolve shellCommand execution and file extension filtering in JS via `@ext:` metadata protocol
- Fix zsh `_files -g` fallback showing all files when no extensions match (file-patterns zstyle)
- Fix bash inline `--opt=value` completion, glob expansion, and stale COMPREPLY
- Add `NoFileCompletion` directive for enum/choices value completions
- Add zpty-based integration tests for real zsh completion system behavior
- Add comprehensive shell completion E2E tests across bash/zsh/fish
