---
"politty": patch
---

Fix two argv-parsing bugs that silently produced wrong values instead of erroring:

- An option expecting a value (e.g. `z.coerce.number()`) followed by a negative-number-looking token, such as `--count -5`, no longer treats the flag as boolean `true` and mis-parses the following token as combined short flags. The token is now consumed as the option's value. Other dash-prefixed tokens (`--`, or another flag like `--verbose`) are left alone so they aren't silently swallowed as a literal value.
- `--flag=true` / `--flag=false` now correctly coerce to booleans for `z.boolean()`-typed fields instead of failing validation with "expected boolean, received string".
