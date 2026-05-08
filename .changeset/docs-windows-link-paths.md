---
"politty": patch
---

Fix cross-file Markdown links in generated docs using OS path separators on Windows. Relative paths emitted by `generateDoc` are now normalised to forward slashes so links like `commands/config.md#config` render correctly across all platforms and Markdown renderers.
