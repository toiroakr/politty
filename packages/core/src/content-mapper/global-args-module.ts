import * as path from "node:path";
import type { CodeFragment, GlobalArgsReference, ImportBinding } from "./entry-analysis.js";

/** The module the generated text augments: the package entry next to the `.politty` file. */
const AUGMENTED_MODULE = "./index.js";
const SCHEMA_NAME = "__polittyGlobalArgsSchema";
const TYPE_NAME = "__PolittyGlobalArgs";
/**
 * Type helpers that turn the schema output into a type an interface can
 * extend. A union output (a schema built with `z.union`, `z.discriminatedUnion`,
 * ...) becomes one object type: keys every member has stay required, the rest
 * become optional, and each value is the union of the members' values.
 */
const EXTENDABLE_HELPERS = [
  "type __PolittyKeys<U> = U extends unknown ? keyof U : never;",
  "type __PolittyValue<U, K extends PropertyKey> = U extends unknown ? (K extends keyof U ? U[K] : never) : never;",
  "type __PolittyIsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;",
  "type __PolittyExtendable<T> = true extends __PolittyIsUnion<T>",
  "  ? { [K in Extract<keyof T, PropertyKey>]: __PolittyValue<T, K> } & { [K in Exclude<__PolittyKeys<T>, keyof T>]?: __PolittyValue<T, K> }",
  "  : T;",
];
const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u;
const DECLARATION_EXTENSION = /\.d(\.[^.]+)?\.([cm]?)ts$/;
const SOURCE_EXTENSION = /\.([cm]?)tsx?$/;

export const EMPTY_MODULE = "export {};\n";

export interface ResolvedModule {
  resolvedFileName: string;
  isExternalLibraryImport?: boolean | undefined;
}

/** Resolves a specifier as TypeScript does for a file in `containingDirectory`. */
export type ResolveModule = (
  specifier: string,
  containingDirectory: string,
) => ResolvedModule | undefined;

export interface GlobalArgsModule {
  text: string;
  problems: string[];
}

/** The specifier that reaches a resolved project file from anywhere: its absolute path, as a `.js` path. */
function absoluteSpecifier(resolvedFileName: string): string {
  const posix = resolvedFileName.split(path.sep).join("/");
  if (DECLARATION_EXTENSION.test(posix)) {
    return posix.replace(DECLARATION_EXTENSION, (_, arbitrary: string | undefined, kind: string) =>
      arbitrary ? arbitrary : `.${kind}js`,
    );
  }
  return posix.replace(SOURCE_EXTENSION, (_, kind: string) => `.${kind}js`);
}

/**
 * Rewrite a specifier written in the entry so it reaches the same module
 * from the generated file. Project files get their absolute path; a package
 * keeps its name, which must resolve to the same file from `generatedDir`.
 */
function rewriteSpecifier(
  specifier: string,
  entry: string,
  generatedDir: string,
  resolve: ResolveModule,
  problems: string[],
): string {
  const fromEntry = resolve(specifier, path.dirname(entry));
  if (!fromEntry) return specifier;
  if (!fromEntry.isExternalLibraryImport) return absoluteSpecifier(fromEntry.resolvedFileName);
  const fromGenerated = resolve(specifier, generatedDir);
  if (fromGenerated?.resolvedFileName !== fromEntry.resolvedFileName) {
    problems.push(
      `"${specifier}" resolves to ${fromEntry.resolvedFileName} from ${entry} but to ${fromGenerated?.resolvedFileName ?? "nothing"} from politty's package, so the globalArgs type cannot be read from it; install it where politty can resolve it as well`,
    );
  }
  return specifier;
}

function importStatements(
  bindings: ImportBinding[],
  rewrite: (specifier: string) => string,
): string[] {
  const groups = new Map<string, ImportBinding[]>();
  for (const binding of bindings) {
    const key = `${binding.specifier}\0${binding.attributes ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), binding]);
  }
  const statements: string[] = [];
  for (const group of groups.values()) {
    const { specifier, attributes } = group[0]!;
    const from = `from ${JSON.stringify(rewrite(specifier))}${attributes ? ` ${attributes}` : ""};`;
    const named: string[] = [];
    const namedOnly = group.filter(
      (binding) => binding.imported !== "*" && binding.imported !== "default",
    );
    const allTypes = namedOnly.length > 0 && namedOnly.every((binding) => binding.typeOnly);
    for (const binding of group) {
      const type = binding.typeOnly && !(allTypes && namedOnly.includes(binding)) ? "type " : "";
      if (binding.imported === "*") {
        statements.push(`import ${type}* as ${binding.local} ${from}`);
      } else if (binding.imported === "default") {
        statements.push(`import ${type}${binding.local} ${from}`);
      } else {
        const imported = IDENTIFIER.test(binding.imported)
          ? binding.imported
          : JSON.stringify(binding.imported);
        named.push(
          `${type}${imported === binding.local ? imported : `${imported} as ${binding.local}`}`,
        );
      }
    }
    if (named.length > 0) {
      statements.push(`import ${allTypes ? "type " : ""}{ ${named.join(", ")} } ${from}`);
    }
  }
  return statements;
}

/**
 * Build the module that augments `GlobalArgs` with the output type of the
 * `globalArgs` schema an entry passes to `runMain`. The schema expression is
 * copied along with the imports and declarations it references, so
 * TypeScript infers its type exactly as it does in the entry.
 * @param reference - What the entry passes as `globalArgs`
 * @param entry - Absolute path of the entry module
 * @param generatedDir - Directory of the `.politty` file the module is served for
 * @param resolve - Resolves specifiers with the project's compiler options
 */
export function buildGlobalArgsModule(
  reference: GlobalArgsReference,
  entry: string,
  generatedDir: string,
  resolve: ResolveModule,
): GlobalArgsModule {
  const problems: string[] = [];
  const rewritten = new Map<string, string>();
  const rewrite = (specifier: string): string => {
    let result = rewritten.get(specifier);
    if (result === undefined) {
      result = rewriteSpecifier(specifier, entry, generatedDir, resolve, problems);
      rewritten.set(specifier, result);
    }
    return result;
  };
  const render = (code: CodeFragment): string =>
    code
      .map((piece) =>
        typeof piece === "string" ? piece : JSON.stringify(rewrite(piece.specifier)),
      )
      .join("");
  const text = [
    ...importStatements(reference.imports, rewrite),
    ...reference.declarations.map(render),
    `const ${SCHEMA_NAME} = ${render(reference.expression)};`,
    ...EXTENDABLE_HELPERS,
    `type ${TYPE_NAME} = __PolittyExtendable<NonNullable<(typeof ${SCHEMA_NAME})["~standard"]["types"]>["output"]>;`,
    `declare module ${JSON.stringify(AUGMENTED_MODULE)} {`,
    `  interface GlobalArgs extends ${TYPE_NAME} {}`,
    "}",
    EMPTY_MODULE,
  ].join("\n");
  return { text, problems };
}
