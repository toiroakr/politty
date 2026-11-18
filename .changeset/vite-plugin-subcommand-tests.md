---
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Add a Vite plugin for Vitest (`politty/vite`, also `@politty/zod/vite`, `@politty/valibot/vite` and `@politty/zod-mini/vite`) so a subcommand can be tested on its own with the global args, `setup` and `cleanup` of the real CLI. Enable it with `plugins: [politty({ tsconfig: "./tsconfig.json" })]` in `vitest.config.ts`. It loads the entry named by the politty content mapper's `entry` option before each test file, with `runMain` recording its command and options instead of running. `runCommand(subcommand, argv)` then finds the subcommand in the recorded tree, runs it through its real path, and applies the recorded `globalArgs`, `setup` and `cleanup` unless the test passes its own, so renaming or moving the subcommand does not change the test.
