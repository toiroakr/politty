---
"politty": patch
---

Fix `args.$source(name)` being unavailable inside a global arg's `effect` when the invoked command declares args of its own. Previously `$source` was attached to the global args only on the branch for commands without their own schema, so the same global effect saw `$source` as `undefined` or `"cli"` depending purely on the shape of the command it ran under. This made `$source` unusable for global flags that need to tell an explicit CLI token apart from a schema default — notably boolean flags, whose parsed value cannot answer that on its own. `EffectContext["args"]` is typed accordingly, so `effect` callbacks can call `$source` without a cast.
