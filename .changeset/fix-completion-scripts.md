---
"politty": patch
---

Fix completion script regressions and move file extension filtering to Node side

- Fix bash fallback to use command existence check instead of exit code
- Move file extension filtering from shell scripts to Node-side `listFilteredFiles`
- Restore `_describe` in zsh script for proper description display
- Remove shell-side `__extensions:` metadata protocol from all shells
