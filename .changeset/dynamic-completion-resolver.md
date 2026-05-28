---
"politty": minor
---

Add `completion.custom.resolve` for in-process JS dynamic completion. The resolver receives a `DynamicCompletionContext` (current word, shell, other parsed arg values, previously supplied values) and returns candidates synchronously or via Promise. Static shell scripts (bash/zsh/fish) now delegate to `<program> __complete --shell <shell>` whenever a field uses `resolve`; the generated bash delegate stays compatible with Bash 3.2. Specifying more than one of `choices`, `shellCommand`, `resolve`, or `expand` on the same field throws.

Type-level note: `generateCandidates(context, { shell })` now returns `Promise<CandidateResult>` and takes a required second argument. `__complete`'s internal `run` is async. Callers using only the high-level `withCompletionCommand` flow are unaffected.
