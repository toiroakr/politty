---
"politty": patch
---

Add a `negation` option for boolean fields. Set it to a string (e.g. `"disable-cache"`) to replace the default `--no-<name>` form with a custom name, to `true` to keep the default `--no-<name>` and advertise it in help/docs/completions, or to `false` to disable negation entirely (both the default `--no-*` and any custom name are rejected). An optional `negationDescription` renders a separate row in help and generated docs. Help output, generated documentation, and shell completions (bash/zsh/fish) all reflect the configuration. Non-boolean fields are rejected at the type level and at runtime.
