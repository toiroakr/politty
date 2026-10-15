import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/compile-cache.ts",
    "src/agent.ts",
    "src/docs.ts",
    "src/completion.ts",
    "src/skill.ts",
    "src/prompt.ts",
    "src/prompt-clack.ts",
    "src/prompt-inquirer.ts",
  ],
  format: ["es"],
  dts: { generator: "tsgo" },
  clean: true,
  treeshake: true,
  sourcemap: false,
  minify: true,
  target: "node22.18",
  outDir: "dist",
  deps: {
    neverBundle: ["loculus", "yaml", "@clack/prompts", "@inquirer/prompts"],
    alwaysBundle: ["@politty/core"],
  },
  fixedExtension: false,
});
