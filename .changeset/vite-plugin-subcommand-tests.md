---
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Add a Vite plugin for Vitest (`politty/vite`, also `@politty/zod/vite`, `@politty/valibot/vite` and `@politty/zod-mini/vite`) so a command, the root or any subcommand, can be tested on its own with the global args, `setup` and `cleanup` of the real CLI. Enable it with `plugins: [politty({ tsconfig: "./tsconfig.json" })]` in `vitest.config.ts`. It loads the entry named by the politty content mapper's `entry` option at the first `runCommand` call of each test file, with `runMain` recording its command and options instead of running, so the `vi.mock` calls of the test file apply to the modules that the entry imports. `runCommand(command, argv)` then finds the command in the recorded tree, runs it through its real path, and applies the recorded `globalArgs`, `setup` and `cleanup` unless the test passes its own, so renaming or moving the command does not change the test.
