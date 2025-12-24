import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/augment.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  splitting: true,
  treeshake: true,
  sourcemap: true,
  minify: false,
  target: "node18",
  outDir: "dist",
  external: ["zod"],
});
