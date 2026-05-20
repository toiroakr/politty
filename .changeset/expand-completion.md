---
"politty": patch
---

Add `completion.custom.expand` for value completion that is pre-enumerated at script-generation time and baked into the static shell script. The user supplies `dependsOn` (sibling arg names that must have static `choices` or an enum schema) and `enumerate(deps)`; politty walks the cartesian product of the dependsOn values, calls `enumerate` for each combination, and emits per-entry scalar variables (bash, indexed via runtime-encoded suffix), a hoisted associative array (zsh), or an inline switch (fish) keyed on those values. No Node process is spawned at TAB time — the shell dispatches via a case lookup or indirect-expansion lookup, taking the same `<10ms` path as static `choices`. Specifying more than one of `choices`, `shellCommand`, `resolve`, or `expand` on the same field throws.
