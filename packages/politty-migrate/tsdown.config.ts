import { defineConfig } from "tsdown";

// tsdown resolves entry/outDir relative to this config file's directory.
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["es"],
  dts: false,
  clean: true,
  treeshake: true,
  sourcemap: false,
  minify: false,
  target: "node18",
  outDir: "dist",
  external: ["typescript"],
  fixedExtension: false,
});
