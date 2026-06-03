/**
 * Locate `assertDocMatch` / `generateDoc` calls in a TypeScript source file and
 * extract the configuration object literal passed to each, using the bundled
 * `typescript` Compiler API (NOT ts-morph).
 *
 * The migration only needs a *structural* view of each config: which keys are
 * present, whether the value is statically analyzable, and the source-text
 * span of the object literal (so the rewriter can splice). We therefore return
 * lightweight descriptors instead of trying to evaluate the config.
 */

import ts from "typescript";

/** The two doc-generation entry points the migration cares about. */
export const DOC_CALL_NAMES = ["assertDocMatch", "generateDoc"] as const;
export type DocCallName = (typeof DOC_CALL_NAMES)[number];

/**
 * Why a config (or one of its properties) cannot be statically rewritten.
 * Mirrors the TODO categories the rewriter emits.
 */
export type DynamicReason = "spread-config" | "variable-ref" | "dynamic-key";

export interface DynamicMarker {
  reason: DynamicReason;
  /** Human-readable hint about what triggered it. */
  detail: string;
}

/** A single recognized property of the config object literal. */
export interface ConfigProperty {
  name: string;
  /** Source text of the value expression. */
  valueText: string;
  /** The value node, for deeper inspection by the generator. */
  node: ts.Expression;
}

/** A located doc-generation call and its (best-effort) parsed config. */
export interface ParsedConfigCall {
  callName: DocCallName;
  /** The argument expression (object literal or spread/var ref). */
  argNode: ts.Expression;
  /** Char offset span of the argument expression in the source. */
  argStart: number;
  argEnd: number;
  /** Recognized object-literal properties (empty when the arg is not a literal). */
  properties: ConfigProperty[];
  /** Spread elements found in the object literal (e.g. `...baseConfig`). */
  spreads: string[];
  /** Reasons the config is not fully static. */
  dynamic: DynamicMarker[];
  /** True when the argument is a plain object literal we can edit in place. */
  isObjectLiteral: boolean;
}

export interface ParseConfigResult {
  sourceFile: ts.SourceFile;
  calls: ParsedConfigCall[];
}

/**
 * Find a same-file top-level `const <name> = <objectLiteral>` declaration and
 * return its initializer object-literal node, following a single level of
 * `as`/parenthesized wrapping (e.g. `const files: Record<..> = { ... } as const`).
 *
 * Returns `undefined` when the identifier is not declared in this file, is not
 * a `const`, or its initializer is not an object literal (e.g. it is itself
 * built from a function call or another variable — those stay dynamic).
 */
export function resolveConstObjectLiteral(
  sf: ts.SourceFile,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  const init = resolveConstInitializer(sf, name);
  return init && ts.isObjectLiteralExpression(init) ? init : undefined;
}

/**
 * Find a same-file TOP-LEVEL `const <name> = <expr>` and return its initializer
 * expression (unwrapping `as`/parenthesized/satisfies wrappers).
 *
 * Resolution is intentionally scoped to STATEMENTS DIRECTLY ON THE SOURCE FILE.
 * We do NOT descend into function/class/block bodies: a same-named `const`
 * declared inside an earlier helper must never shadow (and silently substitute
 * for) the real top-level binding the call site refers to. Doing so previously
 * made render-drop and files-resolution unsound (a nested default-equivalent
 * `const myRender = createCommandRenderer({headingLevel:1})` would mask a
 * genuinely custom top-level `const myRender = makeCustomRenderer()`, silently
 * dropping the custom renderer).
 *
 * If MULTIPLE top-level `const <name>` are found (legal only via different
 * scopes, but possible in malformed/merged sources), we REFUSE to guess and
 * return `undefined` so the caller emits a variable-ref TODO instead of
 * picking one arbitrarily.
 *
 * Returns `undefined` when not found, not a `const`, or ambiguous.
 */
export function resolveConstInitializer(
  sf: ts.SourceFile,
  name: string,
): ts.Expression | undefined {
  const unwrap = (expr: ts.Expression): ts.Expression => {
    let e = expr;
    // Peel `as T`, `<T>expr`, `( expr )`, and `expr satisfies T` wrappers.
    while (
      ts.isAsExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isParenthesizedExpression(e) ||
      ts.isSatisfiesExpression(e)
    ) {
      e = e.expression;
    }
    return e;
  };

  const matches: ts.Expression[] = [];
  // Only iterate TOP-LEVEL statements; never recurse into nested scopes.
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    // Only `const` declarations are safe to inline (a `let`/`var` may be
    // reassigned).
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
    if (!isConst) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
        matches.push(unwrap(decl.initializer));
      }
    }
  }

  // Ambiguous (more than one top-level const of this name): refuse to guess.
  if (matches.length !== 1) return undefined;
  return matches[0];
}

/**
 * Parse a TS source string and return all doc-generation calls.
 */
export function parseConfigSource(fileName: string, text: string): ParseConfigResult {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );

  const calls: ParsedConfigCall[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callName = getCallName(node);
      if (callName && (DOC_CALL_NAMES as readonly string[]).includes(callName)) {
        const arg = node.arguments[0];
        if (arg) {
          calls.push(analyzeArg(callName as DocCallName, arg, sourceFile));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { sourceFile, calls };
}

/** Resolve the called identifier name (handles `a.b()` too). */
function getCallName(node: ts.CallExpression): string | undefined {
  const expr = node.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

function analyzeArg(
  callName: DocCallName,
  arg: ts.Expression,
  sf: ts.SourceFile,
): ParsedConfigCall {
  const result: ParsedConfigCall = {
    callName,
    argNode: arg,
    argStart: arg.getStart(sf),
    argEnd: arg.getEnd(),
    properties: [],
    spreads: [],
    dynamic: [],
    isObjectLiteral: ts.isObjectLiteralExpression(arg),
  };

  if (!ts.isObjectLiteralExpression(arg)) {
    // e.g. `assertDocMatch(docConfig)` — a variable reference.
    result.dynamic.push({
      reason: "variable-ref",
      detail: `config passed as expression: ${arg.getText(sf)}`,
    });
    return result;
  }

  const { properties, spreads, dynamic } = extractProperties(arg, sf);
  result.properties = properties;
  result.spreads = spreads;
  result.dynamic.push(...dynamic);
  return result;
}

/**
 * Extract the recognized properties / spreads / dynamic markers of any object
 * literal node. Shared by the call-arg analyzer and the variable-reference
 * resolver (so a `const files = { ... }` literal is parsed identically).
 */
export function extractProperties(
  obj: ts.ObjectLiteralExpression,
  sf: ts.SourceFile,
): { properties: ConfigProperty[]; spreads: string[]; dynamic: DynamicMarker[] } {
  const properties: ConfigProperty[] = [];
  const spreads: string[] = [];
  const dynamic: DynamicMarker[] = [];

  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop)) {
      const spreadText = prop.expression.getText(sf);
      spreads.push(spreadText);
      dynamic.push({
        reason: "spread-config",
        detail: `spread of ${spreadText}`,
      });
      continue;
    }

    if (ts.isPropertyAssignment(prop)) {
      const name = propName(prop.name, sf);
      if (name === undefined) {
        dynamic.push({
          reason: "dynamic-key",
          detail: `computed key: ${prop.name.getText(sf)}`,
        });
        continue;
      }
      properties.push({
        name,
        valueText: prop.initializer.getText(sf),
        node: prop.initializer,
      });
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      properties.push({
        name: prop.name.text,
        valueText: prop.name.text,
        node: prop.name,
      });
    }
  }

  return { properties, spreads, dynamic };
}

/**
 * Extract a static property name; `undefined` for computed keys (which become a
 * `dynamic-key` TODO).
 */
function propName(name: ts.PropertyName, sf: ts.SourceFile): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    // A string-literal computed name is still static, e.g. `["docs/cli.md"]`.
    if (ts.isStringLiteralLike(name.expression)) {
      return name.expression.text;
    }
    return undefined;
  }
  // NoSubstitutionTemplateLiteral as a key, etc.
  return name.getText(sf);
}

/**
 * Find a property's value node within a config call by key.
 */
export function getProperty(call: ParsedConfigCall, key: string): ConfigProperty | undefined {
  return call.properties.find((p) => p.name === key);
}
