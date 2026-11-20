import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/standard.ts",
    "src/standard-completion.ts",
    "src/standard-docs.ts",
    "src/cli.ts",
    "src/compile-cache.ts",
    "src/agent.ts",
    "src/augment.ts",
    "src/docs.ts",
    "src/completion.ts",
    "src/skill.ts",
    "src/prompt.ts",
    "src/prompt-clack.ts",
    "src/prompt-inquirer.ts",
    "src/content-mapper.ts",
    "src/vite.ts",
  ],
  format: ["es"],
  // `declare module "politty"` augmentation (the GlobalArgs pattern) merges
  // through `export * from "@politty/zod"` re-exports — TypeScript resolves
  // the augmented interface to the same exported symbol — so the d.ts can
  // stay thin re-exports like the runtime.
  dts: { generator: "tsgo" },
  clean: true,
  treeshake: true,
  sourcemap: false,
  minify: true,
  target: "node20.12",
  outDir: "dist",
  deps: {
    neverBundle: ["@politty/zod", "zod", "yaml", "@clack/prompts", "@inquirer/prompts"],
    alwaysBundle: ["@politty/core"],
  },
  fixedExtension: false,
});
