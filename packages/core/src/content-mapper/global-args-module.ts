import * as fs from "node:fs";
import * as path from "node:path";
import {
  analyzeEntry,
  referencedBindings,
  type GlobalArgsCall,
  type ImportBinding,
} from "./entry-analysis.js";

/** The module the generated text augments: the package entry next to the `.politty` file. */
const AUGMENTED_MODULE = "./index.js";
const SCHEMA_NAME = "__polittyGlobalArgsSchema";
const TYPE_NAME = "__PolittyGlobalArgs";

export const EMPTY_MODULE = "export {};\n";

export interface GlobalArgsSource {
  entry: string;
  call: GlobalArgsCall;
  text: string;
}

function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}

function findPackageJson(from: string): string | undefined {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) return undefined;
  }
}

function conditionalTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = conditionalTarget(item);
      if (resolved) return resolved;
    }
    return undefined;
  }
  if (target && typeof target === "object") {
    const conditions = target as Record<string, unknown>;
    for (const key of ["types", "import", "node", "default"]) {
      const resolved = conditionalTarget(conditions[key]);
      if (resolved) return resolved;
    }
  }
  return undefined;
}

/** Resolve a `#` specifier through the `imports` field of the package that owns `fromDir`. */
function resolveSubpathImport(specifier: string, fromDir: string): string | undefined {
  const packageJsonPath = findPackageJson(fromDir);
  if (!packageJsonPath) return undefined;
  let imports: Record<string, unknown> | undefined;
  try {
    imports = (JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { imports?: typeof imports })
      .imports;
  } catch {
    return undefined;
  }
  if (!imports) return undefined;
  const root = path.dirname(packageJsonPath);
  const exact = conditionalTarget(imports[specifier]);
  if (exact) return path.resolve(root, exact);
  for (const [pattern, target] of Object.entries(imports)) {
    const star = pattern.indexOf("*");
    if (star < 0) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    if (specifier.length < prefix.length + suffix.length) continue;
    const resolved = conditionalTarget(target);
    if (!resolved) continue;
    const match = specifier.slice(prefix.length, specifier.length - suffix.length);
    return path.resolve(root, resolved.replaceAll("*", match));
  }
  return undefined;
}

/**
 * Rewrite a specifier written in the entry module so it resolves the same
 * module from the generated file, which lives inside the politty package.
 * Package names resolve the same from both places, so they stay as written.
 */
function rewriteSpecifier(specifier: string, entry: string): string {
  const dir = path.dirname(entry);
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === ".") {
    return toPosix(path.resolve(dir, specifier));
  }
  if (specifier.startsWith("#")) {
    const resolved = resolveSubpathImport(specifier, dir);
    return resolved ? toPosix(resolved) : specifier;
  }
  return specifier;
}

function importStatements(bindings: ImportBinding[], entry: string): string[] {
  const groups = new Map<string, ImportBinding[]>();
  for (const binding of bindings) {
    const key = `${binding.specifier}\0${binding.attributes ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), binding]);
  }
  const statements: string[] = [];
  for (const group of groups.values()) {
    const { specifier, attributes } = group[0]!;
    const from = `from ${JSON.stringify(rewriteSpecifier(specifier, entry))}${attributes ? ` ${attributes}` : ""};`;
    const named: string[] = [];
    for (const binding of group) {
      const type = binding.typeOnly ? "type " : "";
      if (binding.imported === "*") {
        statements.push(`import ${type}* as ${binding.local} ${from}`);
      } else if (binding.imported === "default") {
        statements.push(`import ${type}${binding.local} ${from}`);
      } else {
        const imported = /^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u.test(binding.imported)
          ? binding.imported
          : JSON.stringify(binding.imported);
        named.push(
          `${type}${imported === binding.local ? imported : `${imported} as ${binding.local}`}`,
        );
      }
    }
    if (named.length > 0) statements.push(`import { ${named.join(", ")} } ${from}`);
  }
  return statements;
}

/**
 * Build the module that augments `GlobalArgs` with the output type of the
 * `globalArgs` schema an entry passes to `runMain`. The schema expression is
 * copied along with the top-level imports and declarations it references, so
 * TypeScript infers its type exactly as it does in the entry.
 * @param entry - Absolute path of the entry module
 * @param source - Source text of the entry module
 * @returns The generated module, or undefined when the entry passes no `globalArgs` to `runMain`
 */
export function globalArgsSourceOf(entry: string, source: string): GlobalArgsSource | undefined {
  const analysis = analyzeEntry(source);
  const call = analysis.calls[0];
  if (!call) return undefined;
  const { imports, declarations } = referencedBindings(analysis, call.tokens);
  const text = [
    ...importStatements(imports, entry),
    ...declarations.map((declaration) => declaration.text),
    `const ${SCHEMA_NAME} = ${call.expression};`,
    `type ${TYPE_NAME} = NonNullable<(typeof ${SCHEMA_NAME})["~standard"]["types"]>["output"];`,
    `declare module ${JSON.stringify(AUGMENTED_MODULE)} {`,
    `  interface GlobalArgs extends ${TYPE_NAME} {}`,
    "}",
    EMPTY_MODULE,
  ].join("\n");
  return { entry, call, text };
}
