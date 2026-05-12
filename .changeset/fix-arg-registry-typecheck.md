---
"politty": patch
---

Fix typecheck failure under `@typescript/native-preview` ≥ 20260504.

Zod's registry rewrites the meta type through `$replace<Meta, S>`, and newer TypeScript builds expand the generic `then` signature on `PromiseLike<void>` inside `effect`'s return type during that rewrite, producing a structural type that is no longer assignable to the original `ArgMeta`. The runtime value is unchanged, so `getArgMeta` now restores the static type at the boundary with a localized cast.
