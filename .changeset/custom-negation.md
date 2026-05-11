---
"politty": patch
---

Add custom negation option name for boolean fields. Boolean args can now define a `negation` (e.g. `"disable-cache"`) to replace the default `--no-<name>` form, plus an optional `negationDescription` for help/docs. Help output, generated documentation, and shell completions (bash/zsh/fish) all reflect the custom name.
