---
"politty": patch
---

Fix Windows path separators leaking into generated docs:

- Cross-file Markdown links now use forward slashes (`commands/config.md#config`) instead of `commands\config.md`, so links render correctly on every Markdown renderer.
- Index marker scopes embedded in `rootDoc` files (`<!-- politty:index:<path>:start -->`) are normalized too, so docs generated on Windows can be regenerated on macOS/Linux without silently skipping the index update.
