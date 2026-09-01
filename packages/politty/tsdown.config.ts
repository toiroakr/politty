import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/compile-cache.ts",
    "src/augment.ts",
    "src/docs.ts",
    "src/completion.ts",
    "src/skill.ts",
    "src/prompt.ts",
    "src/prompt-clack.ts",
    "src/prompt-inquirer.ts",
  ],
  format: ["es"],
  // `declare module "politty"` augmentation (the GlobalArgs pattern) merges
  // through `export * from "@politty/zod"` re-exports — TypeScript resolves
  // the augmented interface to the same exported symbol — so the d.ts can
  // stay thin re-exports like the runtime.
  dts: { tsgo: true },
  clean: true,
  treeshake: true,
  sourcemap: false,
  minify: true,
  target: "node20.12",
  outDir: "dist",
  // Runtime stays a re-export of `@politty/zod` so a process mixing both
  // packages shares one adapter registry / arg-metadata store.
  external: ["@politty/zod", "zod", "yaml", "@clack/prompts", "@inquirer/prompts"],
  fixedExtension: false,
});
