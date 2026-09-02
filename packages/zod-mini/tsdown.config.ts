import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/compile-cache.ts",
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
  minify: false,
  target: "node20.12",
  outDir: "dist",
  // `@politty/core` is a private workspace package: it is never published,
  // so its sources are bundled into this package's dist.
  //
  // Both "zod" and "zod/mini" are listed external: this package only ever
  // imports "zod/mini", but keeping the bare "zod" specifier external too
  // means that if classic zod were ever imported by mistake (directly or
  // via core), it stays a visible import specifier instead of getting
  // inlined — which is what `tests/dist-compat/zod-mini-package.test.ts`
  // scans dist output for.
  external: ["zod", "zod/mini", "yaml", "@clack/prompts", "@inquirer/prompts"],
  noExternal: ["@politty/core"],
  fixedExtension: false,
});
