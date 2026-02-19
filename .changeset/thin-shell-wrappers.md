---
"politty": patch
---

Refactor shell completion to move all logic from shell scripts to JS/TS. Shell scripts (bash/zsh/fish) are now thin wrappers that delegate to `__complete --shell={bash,zsh,fish}`. Eliminates `__command:` and `__extensions:` protocol markers by resolving shellCommand execution and file extension filtering directly in JS.
