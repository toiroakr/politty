---
"politty": patch
---

Fix stdout truncation when piped (e.g., `eval "$(cli completion zsh)"`)

Drain stdout buffer before calling `process.exit()` in `runMain`. When stdout is a pipe, Node.js buffers writes asynchronously. Without draining, large outputs (such as shell completion scripts) could be truncated, causing shell syntax errors like `zsh: unmatched "`.
