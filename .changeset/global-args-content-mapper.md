---
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Ship a TypeScript 7.1 content mapper that types `GlobalArgs` from the `globalArgs` schema passed to `runMain`, so commands defined with plain `defineCommand` see the global options without `createDefineCommand` or a hand-written `declare module`. Enable it with `"contentMappers": [{ "package": "politty", "extensions": [".politty"] }]` in `tsconfig.json` and run `tsc --runExternalCode`.
