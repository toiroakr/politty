import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/cli-main.ts",
    "src/compile-cache.ts",
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
  // Keep human-readable names for chunk-internal exports. Single-letter
  // minified export aliases ("arg as s", "lazy as s", …) collide across
  // chunks and confuse AOT compilers (perry) that resolve re-export chains
  // by name; disabling this costs a few bytes and keeps dist debuggable.
  outputOptions: {
    minifyInternalExports: false,
  },
});
