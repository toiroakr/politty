import type * as Ast from "typescript/ast";

type AstModule = typeof Ast;

export interface ImportBinding {
  local: string;
  /** Imported name, `"default"`, or `"*"` for a namespace import */
  imported: string;
  typeOnly: boolean;
  specifier: string;
  /** Source text of an import attributes clause (`with { ... }`), if any */
  attributes: string | undefined;
}

interface TopLevelDeclaration {
  start: number;
  /** Source text to copy, without `export` / `export default` */
  text: string;
  /** Nodes whose identifiers the copied text references */
  references: Ast.Node[];
  /** The initializer, for a variable */
  initializer: Ast.Expression | undefined;
}

export interface GlobalArgsReference {
  /** Source text of the `globalArgs` value */
  expression: string;
  imports: ImportBinding[];
  /** Copied top-level declarations, in source order */
  declarations: string[];
}

const RUN_MAIN = "runMain";
const GLOBAL_ARGS = "globalArgs";
const EXPORT_PREFIX = /^export\s+(default\s+)?/;

class EntryReader {
  readonly imports = new Map<string, ImportBinding>();
  readonly declarations = new Map<string, TopLevelDeclaration[]>();

  constructor(
    readonly ast: AstModule,
    readonly sourceFile: Ast.SourceFile,
  ) {
    for (const statement of sourceFile.statements) this.readStatement(statement);
  }

  text(node: Ast.Node): string {
    return this.sourceFile.text.slice(node.getStart(this.sourceFile), node.end);
  }

  private addDeclaration(name: string, declaration: TopLevelDeclaration): void {
    this.declarations.set(name, [...(this.declarations.get(name) ?? []), declaration]);
  }

  private readStatement(statement: Ast.Statement): void {
    const { ast } = this;
    if (ast.isImportDeclaration(statement)) {
      this.readImport(statement);
    } else if (ast.isVariableStatement(statement)) {
      const declare = statement.modifiers?.some(
        (modifier) => modifier.kind === ast.SyntaxKind.DeclareKeyword,
      );
      const list = statement.declarationList;
      const first = list.declarations[0];
      if (!first) return;
      const keyword = this.sourceFile.text
        .slice(list.getStart(this.sourceFile), first.getStart(this.sourceFile))
        .trim();
      for (const declaration of list.declarations) {
        if (!ast.isIdentifier(declaration.name)) continue;
        this.addDeclaration(declaration.name.text, {
          start: statement.getStart(this.sourceFile),
          text: `${declare ? "declare " : ""}${keyword} ${this.text(declaration)};`,
          references: [declaration.type, declaration.initializer].filter(
            (node): node is Ast.TypeNode | Ast.Expression => node !== undefined,
          ),
          initializer: declaration.initializer,
        });
      }
    } else if (
      ast.isFunctionDeclaration(statement) ||
      ast.isClassDeclaration(statement) ||
      ast.isEnumDeclaration(statement) ||
      ast.isInterfaceDeclaration(statement) ||
      ast.isTypeAliasDeclaration(statement)
    ) {
      const name = statement.name;
      if (!name || !ast.isIdentifier(name)) return;
      this.addDeclaration(name.text, {
        start: statement.getStart(this.sourceFile),
        text: this.text(statement).replace(EXPORT_PREFIX, ""),
        references: [statement],
        initializer: undefined,
      });
    }
  }

  private readImport(statement: Ast.ImportDeclaration): void {
    const { ast } = this;
    const clause = statement.importClause;
    if (!clause || !ast.isStringLiteral(statement.moduleSpecifier)) return;
    const base = {
      specifier: statement.moduleSpecifier.text,
      attributes: statement.attributes ? this.text(statement.attributes) : undefined,
    };
    const clauseTypeOnly = clause.phaseModifier === ast.SyntaxKind.TypeKeyword;
    if (clause.name) {
      this.imports.set(clause.name.text, {
        ...base,
        local: clause.name.text,
        imported: "default",
        typeOnly: clauseTypeOnly,
      });
    }
    const bindings = clause.namedBindings;
    if (!bindings) return;
    if (ast.isNamespaceImport(bindings)) {
      this.imports.set(bindings.name.text, {
        ...base,
        local: bindings.name.text,
        imported: "*",
        typeOnly: clauseTypeOnly,
      });
      return;
    }
    for (const element of bindings.elements) {
      this.imports.set(element.name.text, {
        ...base,
        local: element.name.text,
        imported: (element.propertyName ?? element.name).text,
        typeOnly: clauseTypeOnly || element.isTypeOnly,
      });
    }
  }
}

function sameSpan(a: Ast.Node | undefined, b: Ast.Node): boolean {
  return a !== undefined && a.pos === b.pos && a.end === b.end;
}

/** Whether an identifier names a value or type, rather than a member or a declaration. */
function isReference(ast: AstModule, node: Ast.Identifier): boolean {
  const parent = node.parent as Ast.Node & { name?: Ast.Node; label?: Ast.Node };
  if (ast.isShorthandPropertyAssignment(parent)) return true;
  if (ast.isQualifiedName(parent)) return !sameSpan(parent.right, node);
  if (ast.isPropertyAccessExpression(parent)) return !sameSpan(parent.name, node);
  return !sameSpan(parent.name, node) && !sameSpan(parent.label, node);
}

function collectBindingNames(ast: AstModule, name: Ast.Node | undefined, into: Set<string>): void {
  if (!name) return;
  if (ast.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  name.forEachChild((child) => {
    if (ast.isBindingElement(child)) collectBindingNames(ast, child.name, into);
  });
}

/**
 * Names an expression or declaration reads from the enclosing module. Names
 * it binds itself (parameters, local variables and functions) are left out
 * wherever they appear in it.
 */
function freeNames(ast: AstModule, roots: Ast.Node[]): Set<string> {
  const bound = new Set<string>();
  const referenced = new Set<string>();
  const visit = (node: Ast.Node): void => {
    if (ast.isIdentifier(node)) {
      if (isReference(ast, node)) referenced.add(node.text);
      return;
    }
    if (
      ast.isParameterDeclaration(node) ||
      ast.isVariableDeclaration(node) ||
      ast.isBindingElement(node)
    ) {
      collectBindingNames(ast, node.name, bound);
    } else if (ast.isTypeParameterDeclaration(node)) {
      bound.add(node.name.text);
    } else if (
      (ast.isFunctionExpression(node) ||
        ast.isClassExpression(node) ||
        ast.isFunctionDeclaration(node) ||
        ast.isClassDeclaration(node)) &&
      node.name !== undefined
    ) {
      bound.add(node.name.text);
    }
    node.forEachChild(visit);
  };
  for (const root of roots) visit(root);
  for (const name of bound) referenced.delete(name);
  return referenced;
}

function unwrap(ast: AstModule, node: Ast.Expression): Ast.Expression {
  let current = node;
  while (
    ast.isParenthesizedExpression(current) ||
    ast.isAsExpression(current) ||
    ast.isSatisfiesExpression(current) ||
    ast.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function globalArgsOfOptions(
  reader: EntryReader,
  options: Ast.Expression,
  depth = 0,
): Ast.Expression | undefined {
  const { ast } = reader;
  const node = unwrap(ast, options);
  if (ast.isIdentifier(node) && depth < 4) {
    const initializer = reader.declarations.get(node.text)?.at(-1)?.initializer;
    return initializer && globalArgsOfOptions(reader, initializer, depth + 1);
  }
  if (!ast.isObjectLiteralExpression(node)) return undefined;
  let found: Ast.Expression | undefined;
  for (const property of node.properties) {
    if (ast.isSpreadAssignment(property)) {
      found = undefined;
    } else if (
      ast.isShorthandPropertyAssignment(property) &&
      ast.isIdentifier(property.name) &&
      property.name.text === GLOBAL_ARGS
    ) {
      found = property.name;
    } else if (
      ast.isPropertyAssignment(property) &&
      (ast.isIdentifier(property.name) || ast.isStringLiteral(property.name)) &&
      property.name.text === GLOBAL_ARGS
    ) {
      found = property.initializer;
    }
  }
  return found;
}

function findGlobalArgs(reader: EntryReader): Ast.Expression | undefined {
  const { ast } = reader;
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const binding of reader.imports.values()) {
    if (binding.typeOnly) continue;
    if (binding.imported === RUN_MAIN) names.add(binding.local);
    if (binding.imported === "*") namespaces.add(binding.local);
  }
  let found: Ast.Expression | undefined;
  const visit = (node: Ast.Node): void => {
    if (found) return;
    if (ast.isCallExpression(node)) {
      const callee = node.expression;
      const isRunMain =
        (ast.isIdentifier(callee) && names.has(callee.text)) ||
        (ast.isPropertyAccessExpression(callee) &&
          ast.isIdentifier(callee.expression) &&
          namespaces.has(callee.expression.text) &&
          callee.name.text === RUN_MAIN);
      const options = node.arguments[1];
      if (isRunMain && options) found = globalArgsOfOptions(reader, options);
      if (found) return;
    }
    node.forEachChild(visit);
  };
  reader.sourceFile.forEachChild(visit);
  return found;
}

/**
 * Find the `globalArgs` value of the first `runMain(command, options)` call in
 * an entry module, with the top-level imports and declarations it references,
 * followed transitively through those declarations.
 * @param ast - The `typescript/ast` (or `tsrs/ast`) module the source file was parsed with
 * @param sourceFile - The parsed entry module
 * @returns undefined when the entry passes no `globalArgs` to `runMain` that can be read
 */
export function readGlobalArgs(
  ast: AstModule,
  sourceFile: Ast.SourceFile,
): GlobalArgsReference | undefined {
  const reader = new EntryReader(ast, sourceFile);
  const expression = findGlobalArgs(reader);
  if (!expression) return undefined;

  const imports = new Map<string, ImportBinding>();
  const declarations = new Set<TopLevelDeclaration>();
  const visited = new Set<string>();
  const pending = [...freeNames(ast, [expression])];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (visited.has(name)) continue;
    visited.add(name);
    const binding = reader.imports.get(name);
    if (binding) {
      imports.set(name, binding);
      continue;
    }
    for (const declaration of reader.declarations.get(name) ?? []) {
      declarations.add(declaration);
      pending.push(...freeNames(ast, declaration.references));
    }
  }
  return {
    expression: reader.text(expression),
    imports: [...reader.imports.values()].filter((binding) => imports.has(binding.local)),
    declarations: [...declarations].sort((a, b) => a.start - b.start).map(({ text }) => text),
  };
}
