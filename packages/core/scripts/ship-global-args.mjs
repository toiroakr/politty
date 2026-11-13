import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const GLOBAL_ARGS_FILE = "global-args.politty";
const GLOBAL_ARGS_IMPORT = `// @ts-ignore\nimport "./${GLOBAL_ARGS_FILE}";\n`;
const GLOBAL_ARGS_NOTE = [
  "// TypeScript does not read this file. politty's content mapper derives GlobalArgs from the",
  "// globalArgs schema your entry passes to runMain, so commands get typed global args without",
  "// createDefineCommand or a hand-written `declare module` augmentation.",
  '// Enable it in tsconfig.json: "contentMappers": [{ "package": "<this package>", "extensions": [".politty"] }]',
  "",
].join("\n");

/**
 * Ship the `.politty` file the content mapper types, and make the entry types import it.
 * @param {string} distDir - Build output directory of the package
 */
export function shipGlobalArgs(distDir) {
  const entryTypes = join(distDir, "index.d.ts");
  const source = readFileSync(entryTypes, "utf8");
  writeFileSync(join(distDir, GLOBAL_ARGS_FILE), GLOBAL_ARGS_NOTE);
  if (!source.startsWith(GLOBAL_ARGS_IMPORT)) {
    writeFileSync(entryTypes, GLOBAL_ARGS_IMPORT + source);
  }
}

shipGlobalArgs(resolve(process.argv[2] ?? "dist"));
