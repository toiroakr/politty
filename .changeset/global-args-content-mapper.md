---
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Ship a TypeScript 7.1 content mapper that types `GlobalArgs` from the `globalArgs` schema passed to `runMain`, so commands defined with plain `defineCommand` see the global options without `createDefineCommand` or a hand-written `declare module`. Enable it with `"contentMappers": [{ "package": "politty", "extensions": [".politty"], "options": { "entry": "<module that calls runMain>" } }]` in `tsconfig.json` and type-check with `tsc --runExternalCode` (TypeScript 7.1+) or `tsrs --runExternalCode`. The mapper reads the entry with the JavaScript API of the `typescript` or `tsrs` package installed in the project; the `compiler` option picks one.
