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
  // TypeScript 7 (tsgo) has no JS compiler API, which breaks the plugin's
  // default tsc-based DTS generation — generate declarations with the tsgo
  // binary from `@typescript/native-preview` instead.
  dts: { tsgo: true },
  clean: true,
  treeshake: true,
  sourcemap: false,
  minify: true,
  target: "node20.12",
  outDir: "dist",
  // `@politty/core` is a private workspace package: it is never published,
  // so its sources are bundled into this package's dist.
  external: ["zod", "yaml", "@clack/prompts", "@inquirer/prompts"],
  noExternal: ["@politty/core"],
  fixedExtension: false,
});
