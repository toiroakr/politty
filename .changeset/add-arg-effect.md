---
"politty": patch
---

Add `effect` callback to `arg()` metadata for executing side effects after argument parsing and validation. The effect `value` parameter is type-safe via Zod schema output type, and `EffectContext.globalArgs` provides typed access to global args (via declaration merging) in command arg effects.
