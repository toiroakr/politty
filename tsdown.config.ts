import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/augment.ts",
    "src/docs/index.ts",
    "src/completion/index.ts",
    "src/prompt/index.ts",
    "src/prompt/clack/index.ts",
    "src/prompt/inquirer/index.ts",
  ],
  format: ["es"],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: false,
  minify: false,
  target: "node18",
  outDir: "dist",
  external: ["zod", "string-width", "@clack/prompts", "@inquirer/prompts"],
  fixedExtension: false,
});
