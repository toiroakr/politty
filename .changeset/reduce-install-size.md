---
"politty": minor
---

Reduced installation size (2.9MB to approx. 630KB, approx. 78% reduction)

- Excluded source maps (.map) from the distribution
- Explicitly excluded build artifacts such as build cache (tsconfig.tsbuildinfo) using the files field
- BREAKING: Discontinued CJS distribution and changed to ESM-only (loading via require() is no longer possible, removed .cjs and index.d.cts)
