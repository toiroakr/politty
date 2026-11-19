---
"politty": patch
"@politty/zod": patch
"@politty/valibot": patch
"@politty/zod-mini": patch
---

Make the Vite plugin throw an error that names both entries when `politty()` is registered with two different entries in one Vitest project (also across the `vite` subpaths of different politty packages), or when the tsconfig lists politty content mappers with different `entry` options. The plugin used to keep one entry and ignore the other without a message. Use one tsconfig and one `test.projects` item per CLI.
