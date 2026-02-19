import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/augment.ts", "src/docs/index.ts", "src/completion/index.ts"],
  format: ["es", "cjs"],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: true,
  minify: false,
  target: "node18",
  outDir: "dist",
  external: ["zod", "string-width"],
  fixedExtension: false,
});
