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

/** A module specifier inside copied code, written in the entry's terms. */
export interface SpecifierPiece {
  specifier: string;
  /** Whether it is the argument of an `import()` call, which Node resolves as ESM in any module */
  dynamic: boolean;
}

/** Copied source: text, with the module specifiers it contains kept apart to rewrite. */
export type CodeFragment = (string | SpecifierPiece)[];

interface TopLevelDeclaration {
  start: number;
  code: CodeFragment;
  /** Nodes whose identifiers the copied code references */
  references: Ast.Node[];
  /** The initializer, for a variable */
  initializer: Ast.Expression | undefined;
}

export interface GlobalArgsReference {
  /** The `globalArgs` value */
  expression: CodeFragment;
  imports: ImportBinding[];
  /** Copied top-level declarations, in source order */
  declarations: CodeFragment[];
}

const RUN_MAIN = "runMain";
const GLOBAL_ARGS = "globalArgs";
const EXPORT_PREFIX = /^export\s+(default\s+)?/;

function bindingNames(ast: AstModule, name: Ast.Node | undefined, into: string[] = []): string[] {
  if (!name) return into;
  if (ast.isIdentifier(name)) {
    into.push(name.text);
    return into;
  }
  name.forEachChild((child) => {
    if (ast.isBindingElement(child)) bindingNames(ast, child.name, into);
  });
  return into;
}

class EntryReader {
  readonly imports = new Map<string, ImportBinding>();
  readonly declarations = new Map<string, TopLevelDeclaration[]>();

  constructor(
    readonly ast: AstModule,
    readonly sourceFile: Ast.SourceFile,
  ) {
    for (const statement of sourceFile.statements) this.readStatement(statement);
  }

  /** Source of `node`, split around the module specifiers of `import()` calls and types in it. */
  code(node: Ast.Node): CodeFragment {
    const { ast, sourceFile } = this;
    const literals: { literal: Ast.Node; dynamic: boolean }[] = [];
    const visit = (child: Ast.Node): void => {
      if (
        ast.isImportTypeNode(child) &&
        ast.isLiteralTypeNode(child.argument) &&
        ast.isStringLiteral(child.argument.literal)
      ) {
        literals.push({ literal: child.argument.literal, dynamic: false });
      } else if (
        ast.isCallExpression(child) &&
        child.expression.kind === ast.SyntaxKind.ImportKeyword &&
        child.arguments[0] !== undefined &&
        ast.isStringLiteral(child.arguments[0])
      ) {
        literals.push({ literal: child.arguments[0], dynamic: true });
      }
      child.forEachChild(visit);
    };
    visit(node);
    const code: CodeFragment = [];
    let position = node.getStart(sourceFile);
    for (const { literal, dynamic } of literals.sort((a, b) => a.literal.pos - b.literal.pos)) {
      const start = literal.getStart(sourceFile);
      code.push(sourceFile.text.slice(position, start), {
        specifier: (literal as Ast.StringLiteral).text,
        dynamic,
      });
      position = literal.end;
    }
    code.push(sourceFile.text.slice(position, node.end));
    return code;
  }

  private addDeclaration(names: string[], declaration: TopLevelDeclaration): void {
    for (const name of names) {
      this.declarations.set(name, [...(this.declarations.get(name) ?? []), declaration]);
    }
  }

  private readStatement(statement: Ast.Statement): void {
    const { ast, sourceFile } = this;
    if (ast.isImportDeclaration(statement)) {
      this.readImport(statement);
    } else if (ast.isVariableStatement(statement)) {
      const declare = statement.modifiers?.some(
        (modifier) => modifier.kind === ast.SyntaxKind.DeclareKeyword,
      );
      const list = statement.declarationList;
      const first = list.declarations[0];
      if (!first) return;
      const keyword = sourceFile.text
        .slice(list.getStart(sourceFile), first.getStart(sourceFile))
        .trim();
      for (const declaration of list.declarations) {
        this.addDeclaration(bindingNames(ast, declaration.name), {
          start: declaration.getStart(sourceFile),
          code: [`export ${declare ? "declare " : ""}${keyword} `, ...this.code(declaration), ";"],
          references: [declaration.name, declaration.type, declaration.initializer].filter(
            (node) => node !== undefined,
          ),
          initializer: ast.isIdentifier(declaration.name) ? declaration.initializer : undefined,
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
      const [head, ...rest] = this.code(statement);
      this.addDeclaration([name.text], {
        start: statement.getStart(sourceFile),
        code: [
          typeof head === "string" ? `export ${head.replace(EXPORT_PREFIX, "")}` : head!,
          ...rest,
        ],
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
      attributes: statement.attributes
        ? this.sourceFile.text.slice(
            statement.attributes.getStart(this.sourceFile),
            statement.attributes.end,
          )
        : undefined,
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
  const parent = node.parent as Ast.Node & {
    name?: Ast.Node;
    label?: Ast.Node;
    propertyName?: Ast.Node;
  };
  if (ast.isShorthandPropertyAssignment(parent)) return true;
  if (ast.isQualifiedName(parent)) return !sameSpan(parent.right, node);
  if (ast.isPropertyAccessExpression(parent)) return !sameSpan(parent.name, node);
  return (
    !sameSpan(parent.name, node) &&
    !sameSpan(parent.label, node) &&
    !sameSpan(parent.propertyName, node)
  );
}

interface ScopeFields {
  statements?: readonly Ast.Statement[];
  parameters?: readonly Ast.ParameterDeclaration[];
  typeParameters?: readonly Ast.TypeParameterDeclaration[];
}

/** Names a node declares for the code inside it: its parameters, type parameters and block-level declarations. */
function scopeOf(ast: AstModule, node: Ast.Node): Set<string> {
  const names: string[] = [];
  const { statements, parameters, typeParameters } = node as Ast.Node & ScopeFields;
  for (const statement of statements ?? []) {
    if (ast.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        bindingNames(ast, declaration.name, names);
      }
    } else if (
      (ast.isFunctionDeclaration(statement) ||
        ast.isClassDeclaration(statement) ||
        ast.isEnumDeclaration(statement) ||
        ast.isInterfaceDeclaration(statement) ||
        ast.isTypeAliasDeclaration(statement)) &&
      statement.name !== undefined &&
      ast.isIdentifier(statement.name)
    ) {
      names.push(statement.name.text);
    }
  }
  for (const parameter of parameters ?? []) bindingNames(ast, parameter.name, names);
  for (const typeParameter of typeParameters ?? []) names.push(typeParameter.name.text);
  if ((ast.isFunctionExpression(node) || ast.isClassExpression(node)) && node.name) {
    names.push(node.name.text);
  }
  if (ast.isMappedTypeNode(node)) names.push(node.typeParameter.name.text);
  if (ast.isCatchClause(node) && node.variableDeclaration) {
    bindingNames(ast, node.variableDeclaration.name, names);
  }
  if (
    (ast.isForStatement(node) || ast.isForInStatement(node) || ast.isForOfStatement(node)) &&
    node.initializer !== undefined &&
    ast.isVariableDeclarationList(node.initializer)
  ) {
    for (const declaration of node.initializer.declarations) {
      bindingNames(ast, declaration.name, names);
    }
  }
  return new Set(names);
}

/** The `infer` type parameters a conditional type's `extends` clause declares, nested conditionals aside. */
function inferredNames(ast: AstModule, extendsType: Ast.Node): Set<string> {
  const names = new Set<string>();
  const collect = (child: Ast.Node): void => {
    if (ast.isInferTypeNode(child)) names.add(child.typeParameter.name.text);
    if (!ast.isConditionalTypeNode(child)) child.forEachChild(collect);
  };
  collect(extendsType);
  return names;
}

/** Names the given code reads from the enclosing module, following lexical scopes. */
function freeNames(ast: AstModule, roots: Ast.Node[]): Set<string> {
  const referenced = new Set<string>();
  const visit = (node: Ast.Node, scopes: Set<string>[]): void => {
    if (ast.isIdentifier(node)) {
      if (isReference(ast, node) && !scopes.some((scope) => scope.has(node.text))) {
        referenced.add(node.text);
      }
      return;
    }
    if (ast.isConditionalTypeNode(node)) {
      const inferred = [...scopes, inferredNames(ast, node.extendsType)];
      visit(node.checkType, scopes);
      visit(node.extendsType, inferred);
      visit(node.trueType, inferred);
      visit(node.falseType, scopes);
      return;
    }
    const own = scopeOf(ast, node);
    const inner = own.size > 0 ? [...scopes, own] : scopes;
    node.forEachChild((child) => visit(child, inner));
  };
  for (const root of roots) visit(root, []);
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

/**
 * Whether a property the mapper cannot read may still set `globalArgs`: one
 * with a computed key, or a method or accessor named `globalArgs`.
 */
function mayDefineGlobalArgs(ast: AstModule, property: Ast.ObjectLiteralElementLike): boolean {
  const name = (property as { name?: Ast.Node }).name;
  if (!name) return false;
  if (ast.isComputedPropertyName(name)) return true;
  return (ast.isIdentifier(name) || ast.isStringLiteral(name)) && name.text === GLOBAL_ARGS;
}

function globalArgsOfOptions(
  reader: EntryReader,
  options: Ast.Expression,
  followed = new Set<string>(),
): Ast.Expression | undefined {
  const { ast } = reader;
  const node = unwrap(ast, options);
  if (ast.isIdentifier(node)) {
    if (followed.has(node.text)) return undefined;
    followed.add(node.text);
    const initializer = reader.declarations.get(node.text)?.at(-1)?.initializer;
    return initializer && globalArgsOfOptions(reader, initializer, followed);
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
    } else if (mayDefineGlobalArgs(ast, property)) {
      found = undefined;
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

  const imports = new Set<string>();
  const declarations = new Set<TopLevelDeclaration>();
  const visited = new Set<string>();
  const pending = [...freeNames(ast, [expression])];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (visited.has(name)) continue;
    visited.add(name);
    if (reader.imports.has(name)) {
      imports.add(name);
      continue;
    }
    for (const declaration of reader.declarations.get(name) ?? []) {
      if (declarations.has(declaration)) continue;
      declarations.add(declaration);
      pending.push(...freeNames(ast, declaration.references));
    }
  }
  return {
    expression: reader.code(expression),
    imports: [...reader.imports.values()].filter((binding) => imports.has(binding.local)),
    declarations: [...declarations].sort((a, b) => a.start - b.start).map(({ code }) => code),
  };
}
