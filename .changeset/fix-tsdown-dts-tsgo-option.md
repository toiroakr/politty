---
"politty": patch
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
---

Fixed the build breaking after the tsdown 0.23.0 bump: `dts.tsgo` changed from a boolean flag to an options object (`{ path?: string }`), so the existing `dts: { tsgo: true }` in each package's `tsdown.config.ts` failed both `tsc`'s type check and, at runtime, `rolldown-plugin-dts`'s option resolver (`Cannot create property 'path' on boolean 'true'`). Changed to `dts: { tsgo: {} }` to match the new shape.
