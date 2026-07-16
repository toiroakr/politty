import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/augment.ts",
    "src/docs/index.ts",
    "src/completion/index.ts",
    "src/skill/index.ts",
    "src/prompt/index.ts",
    "src/prompt/clack/index.ts",
    "src/prompt/inquirer/index.ts",
  ],
  format: ["es"],
  // TypeScript 7 (tsgo) has no JS compiler API, which breaks the plugin's
  // default tsc-based DTS generation — generate declarations with the tsgo
  // binary from `@typescript/native-preview` instead.
  dts: { tsgo: true },
  clean: true,
  treeshake: true,
  sourcemap: false,
  minify: false,
  target: "node20.12",
  outDir: "dist",
  external: ["zod", "yaml", "@clack/prompts", "@inquirer/prompts"],
  fixedExtension: false,
});
