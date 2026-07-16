---
"politty": patch
---

Fix `.d.ts` generation broken by the TypeScript 7 upgrade. TypeScript 7 (tsgo) has no JS compiler API, so rolldown-plugin-dts's default tsc-based DTS generation crashed the build (and the Release workflow). tsdown now generates declarations with the tsgo binary from `@typescript/native-preview`; the emitted declarations are equivalent to the previous tsc output.
