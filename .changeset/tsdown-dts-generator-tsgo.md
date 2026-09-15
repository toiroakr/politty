---
"politty": patch
---

Fix the build and typecheck failing against `rolldown-plugin-dts` 0.28.5, which repurposed the DTS plugin's `tsgo` option from a boolean switch into a `TsgoOptions` object. Every package's `tsdown.config.ts` still passed `dts: { tsgo: true }` and now selects the tsgo generator through `dts: { generator: "tsgo" }` instead.
