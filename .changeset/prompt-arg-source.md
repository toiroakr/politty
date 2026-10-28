---
"@politty/loculus": minor
"@politty/valibot": minor
"@politty/zod": minor
"@politty/zod-mini": minor
"politty": minor
---

Add `"prompt"` to `ArgSource`: `$source` now reports `"prompt"` for a value answered by a `prompt` resolver instead of `"default"`, whether the resolver returns the answer or writes it into `rawArgs` in place (in-place answers were previously reported as `"cli"`). Code that checks `$source(name) === "default"` to detect prompted values, or exhaustively matches `ArgSource`, needs updating.
