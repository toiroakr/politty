---
"politty": patch
---

Fix two argv-parsing bugs that silently produced wrong values instead of erroring:

- An option expecting a value (e.g. `z.coerce.number()`) followed by a `-`-prefixed token, such as `--count -5`, no longer treats the flag as boolean `true` and mis-parses the following token as combined short flags. The token is now consumed as the option's value, matching standard getopt-style parsing. `--` still terminates option parsing rather than being swallowed as a literal value.
- `--flag=true` / `--flag=false` now correctly coerce to booleans for `z.boolean()`-typed fields instead of failing validation with "expected boolean, received string".
