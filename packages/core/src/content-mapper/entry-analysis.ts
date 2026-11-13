import { tokenize, type Token } from "./lexer.js";

export interface ImportBinding {
  local: string;
  /** Imported name, `"default"`, or `"*"` for a namespace import */
  imported: string;
  typeOnly: boolean;
  specifier: string;
  /** Source text of an import attributes clause (`with { ... }`), if any */
  attributes: string | undefined;
}

export interface Declaration {
  name: string;
  start: number;
  /** Source text to copy, with any `export` / `export default` modifier removed */
  text: string;
  /** Token range (start inclusive, end exclusive) whose identifiers the text references */
  tokens: [number, number];
}

export interface GlobalArgsCall {
  /** Source text of the `globalArgs` value */
  expression: string;
  tokens: [number, number];
}

export interface EntryAnalysis {
  source: string;
  tokens: Token[];
  imports: Map<string, ImportBinding>;
  declarations: Map<string, Declaration>;
  calls: GlobalArgsCall[];
}

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set([")", "]", "}"]);
const DECLARATION_KEYWORDS = new Set(["const", "let", "var"]);
const EXPRESSION_END_KINDS = new Set(["identifier", "string", "number", "regex", "template"]);
const CONTINUATION_PUNCTUATORS = new Set([
  ".",
  "?.",
  "?",
  ":",
  ",",
  "=>",
  "=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "&&",
  "||",
  "??",
  "&",
  "|",
  "^",
  "<",
  ">",
  "<=",
  ">=",
  "==",
  "===",
  "!=",
  "!==",
  "<<",
  ">>",
  ">>>",
  ")",
  "]",
  "}",
]);
const CONTINUATION_KEYWORDS = new Set(["as", "satisfies", "in", "instanceof"]);
const RUN_MAIN = "runMain";

class Cursor {
  constructor(
    readonly source: string,
    readonly tokens: Token[],
  ) {}

  at(index: number): Token | undefined {
    return this.tokens[index];
  }

  is(index: number, value: string): boolean {
    return this.tokens[index]?.value === value;
  }

  /** Index of the token closing the group opened at `index`, or the last index when unbalanced. */
  matching(index: number): number {
    let depth = 0;
    for (let i = index; i < this.tokens.length; i++) {
      const value = this.tokens[i]!.value;
      if (this.tokens[i]!.kind !== "punctuator") continue;
      if (value in OPENERS) depth++;
      else if (CLOSERS.has(value) && --depth === 0) return i;
    }
    return this.tokens.length - 1;
  }

  newlineBetween(left: number, right: number): boolean {
    const a = this.tokens[left];
    const b = this.tokens[right];
    return !!a && !!b && this.source.slice(a.end, b.start).includes("\n");
  }

  text(first: number, last: number): string {
    return this.source.slice(this.tokens[first]!.start, this.tokens[last]!.end);
  }

  /**
   * Index one past the last token of the expression or type starting at
   * `index`. It ends before a `,` / `;` / closer at its own nesting level,
   * or, failing those, where automatic semicolon insertion would end it.
   */
  expressionEnd(index: number, stopAtAngle = false): number {
    let angle = 0;
    for (let i = index; i < this.tokens.length; i++) {
      const token = this.tokens[i]!;
      if (token.kind === "punctuator") {
        if (token.value in OPENERS) {
          i = this.matching(i);
          if (this.endsStatement(i)) return i + 1;
          continue;
        }
        if (CLOSERS.has(token.value) || token.value === ";") return i;
        if (token.value === ",") {
          if (angle === 0) return i;
          continue;
        }
        if (stopAtAngle) {
          if (token.value === "<") angle++;
          else if (token.value === ">" && angle > 0) angle--;
          else if (token.value === ">>" && angle > 0) angle = Math.max(0, angle - 2);
          else if (token.value === "=" && angle === 0) return i;
        }
      }
      if (this.endsStatement(i)) return i + 1;
    }
    return this.tokens.length;
  }

  private endsStatement(index: number): boolean {
    const token = this.tokens[index]!;
    const next = this.tokens[index + 1];
    if (!next || !this.newlineBetween(index, index + 1)) return false;
    const canEnd =
      EXPRESSION_END_KINDS.has(token.kind) ||
      (token.kind === "punctuator" && CLOSERS.has(token.value));
    if (!canEnd) return false;
    if (token.kind === "identifier" && CONTINUATION_KEYWORDS.has(token.value)) return false;
    if (next.kind === "punctuator") {
      return !CONTINUATION_PUNCTUATORS.has(next.value) && next.value !== "(" && next.value !== "[";
    }
    if (next.kind === "template") return false;
    return !(next.kind === "identifier" && CONTINUATION_KEYWORDS.has(next.value));
  }
}

function parseImport(cursor: Cursor, index: number, imports: Map<string, ImportBinding>): number {
  let i = index + 1;
  if (cursor.is(i, "(") || cursor.is(i, ".")) return i;
  let typeOnly = false;
  if (
    cursor.is(i, "type") &&
    cursor.at(i + 1)?.kind === "identifier" &&
    !cursor.is(i + 1, "from")
  ) {
    typeOnly = true;
    i++;
  } else if (cursor.is(i, "type") && cursor.is(i + 1, "{")) {
    typeOnly = true;
    i++;
  } else if (cursor.is(i, "type") && cursor.is(i + 1, "*")) {
    typeOnly = true;
    i++;
  }
  if (cursor.at(i)?.kind === "string") return i + 1;

  const bindings: Omit<ImportBinding, "specifier" | "attributes">[] = [];
  while (i < cursor.tokens.length && !cursor.is(i, "from")) {
    const token = cursor.at(i)!;
    if (token.value === "*" && cursor.is(i + 1, "as")) {
      bindings.push({ local: cursor.at(i + 2)!.value, imported: "*", typeOnly });
      i += 3;
    } else if (token.value === "{") {
      const close = cursor.matching(i);
      for (let j = i + 1; j < close; j++) {
        if (cursor.is(j, ",")) continue;
        let specifierTypeOnly = typeOnly;
        if (
          cursor.is(j, "type") &&
          !cursor.is(j + 1, ",") &&
          !cursor.is(j + 1, "as") &&
          j + 1 < close
        ) {
          specifierTypeOnly = true;
          j++;
        }
        const imported = cursor.at(j)!;
        let local = imported.value;
        if (cursor.is(j + 1, "as")) {
          local = cursor.at(j + 2)!.value;
          j += 2;
        }
        const importedName =
          imported.kind === "string" ? imported.value.slice(1, -1) : imported.value;
        bindings.push({ local, imported: importedName, typeOnly: specifierTypeOnly });
      }
      i = close + 1;
    } else if (token.kind === "identifier") {
      bindings.push({ local: token.value, imported: "default", typeOnly });
      i++;
    } else if (token.value === ",") {
      i++;
    } else {
      return i;
    }
  }
  const specifierToken = cursor.at(i + 1);
  if (!specifierToken || specifierToken.kind !== "string") return i + 1;
  const specifier = specifierToken.value.slice(1, -1);
  i += 2;
  let attributes: string | undefined;
  if ((cursor.is(i, "with") || cursor.is(i, "assert")) && cursor.is(i + 1, "{")) {
    const close = cursor.matching(i + 1);
    attributes = cursor.text(i, close);
    i = close + 1;
  }
  for (const binding of bindings) imports.set(binding.local, { ...binding, specifier, attributes });
  return i;
}

function parseVariables(
  cursor: Cursor,
  keywordIndex: number,
  modifierStart: number,
  declarations: Map<string, Declaration>,
): number {
  const keyword = cursor.at(keywordIndex)!.value;
  const prefix = cursor.is(keywordIndex - 1, "declare") ? `declare ${keyword}` : keyword;
  let i = keywordIndex + 1;
  for (;;) {
    const nameIndex = i;
    const nameToken = cursor.at(nameIndex);
    if (!nameToken) return i;
    i = nameToken.value === "{" || nameToken.value === "[" ? cursor.matching(i) + 1 : i + 1;
    if (cursor.is(i, "!")) i++;
    if (cursor.is(i, ":")) i = cursor.expressionEnd(i + 1, true);
    if (cursor.is(i, "=")) i = cursor.expressionEnd(i + 1);
    if (nameToken.kind === "identifier") {
      declarations.set(nameToken.value, {
        name: nameToken.value,
        start: cursor.at(modifierStart)!.start,
        text: `${prefix} ${cursor.text(nameIndex, i - 1)};`,
        tokens: [nameIndex + 1, i],
      });
    }
    if (!cursor.is(i, ",")) return cursor.is(i, ";") ? i + 1 : i;
    i++;
  }
}

/** Index of the `{` opening the body of a function or class whose header starts at `index`. */
function bodyStart(cursor: Cursor, index: number): number {
  for (let i = index; i < cursor.tokens.length; i++) {
    const token = cursor.at(i)!;
    if (token.value === "{") {
      const previous = cursor.at(i - 1)!;
      const typeContinues =
        previous.kind === "punctuator" &&
        [":", "|", "&", "<", ",", "=>", "("].includes(previous.value);
      if (!typeContinues) return i;
      i = cursor.matching(i);
    } else if (token.value === "(" || token.value === "[") {
      i = cursor.matching(i);
    }
  }
  return cursor.tokens.length - 1;
}

function parseBlockDeclaration(
  cursor: Cursor,
  keywordIndex: number,
  modifierStart: number,
  textStart: number,
  declarations: Map<string, Declaration>,
): number {
  let nameIndex = keywordIndex + 1;
  if (cursor.is(nameIndex, "*")) nameIndex++;
  const nameToken = cursor.at(nameIndex);
  const open = bodyStart(cursor, nameIndex);
  const close = cursor.matching(open);
  if (nameToken?.kind === "identifier") {
    declarations.set(nameToken.value, {
      name: nameToken.value,
      start: cursor.at(modifierStart)!.start,
      text: cursor.text(textStart, close),
      tokens: [nameIndex + 1, close + 1],
    });
  }
  return close + 1;
}

function parseTopLevel(cursor: Cursor): {
  imports: Map<string, ImportBinding>;
  declarations: Map<string, Declaration>;
} {
  const imports = new Map<string, ImportBinding>();
  const declarations = new Map<string, Declaration>();
  let i = 0;
  while (i < cursor.tokens.length) {
    const token = cursor.at(i)!;
    const previous = cursor.at(i - 1);
    const afterDot = previous?.value === "." || previous?.value === "?.";
    if (token.kind === "punctuator" && token.value in OPENERS) {
      i = cursor.matching(i) + 1;
      continue;
    }
    if (token.kind !== "identifier" || afterDot) {
      i++;
      continue;
    }
    if (token.value === "import") {
      i = Math.max(parseImport(cursor, i, imports), i + 1);
      continue;
    }

    const modifierStart = i;
    let j = i;
    if (cursor.is(j, "export")) j++;
    if (cursor.is(j, "default")) j++;
    const textStart = j;
    while (cursor.is(j, "declare") || cursor.is(j, "async") || cursor.is(j, "abstract")) j++;
    if (cursor.is(j, "const") && cursor.is(j + 1, "enum")) j++;
    const keyword = cursor.at(j)?.value;
    const declarator = cursor.at(j + 1);
    if (
      keyword &&
      DECLARATION_KEYWORDS.has(keyword) &&
      declarator &&
      (declarator.kind === "identifier" || declarator.value === "{" || declarator.value === "[")
    ) {
      i = parseVariables(cursor, j, modifierStart, declarations);
    } else if (keyword === "function" || keyword === "class" || keyword === "enum") {
      i = parseBlockDeclaration(cursor, j, modifierStart, textStart, declarations);
    } else {
      i = j > i ? j : i + 1;
    }
  }
  return { imports, declarations };
}

function runMainCallees(imports: Map<string, ImportBinding>): {
  names: Set<string>;
  namespaces: Set<string>;
} {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const binding of imports.values()) {
    if (binding.typeOnly) continue;
    if (binding.imported === RUN_MAIN) names.add(binding.local);
    if (binding.imported === "*") namespaces.add(binding.local);
  }
  return { names, namespaces };
}

/** Split the argument list of the call whose `(` is at `open` into token ranges. */
function callArguments(cursor: Cursor, open: number): [number, number][] {
  const close = cursor.matching(open);
  const args: [number, number][] = [];
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const value = cursor.at(i)!.value;
    if (cursor.at(i)!.kind === "punctuator" && value in OPENERS) i = cursor.matching(i);
    else if (value === ",") {
      args.push([start, i]);
      start = i + 1;
    }
  }
  if (start < close) args.push([start, close]);
  return args;
}

function globalArgsInObject(cursor: Cursor, open: number): GlobalArgsCall | undefined {
  const close = cursor.matching(open);
  let found: GlobalArgsCall | undefined;
  for (let i = open + 1; i < close;) {
    const end = Math.max(cursor.expressionEnd(i), i + 1);
    const key = cursor.at(i)!;
    const keyName = key.kind === "string" ? key.value.slice(1, -1) : key.value;
    if (key.value === "...") {
      found = undefined;
    } else if (keyName === "globalArgs" && cursor.is(i + 1, ":") && end > i + 2) {
      found = { expression: cursor.text(i + 2, end - 1), tokens: [i + 2, end] };
    } else if (key.kind === "identifier" && keyName === "globalArgs" && end === i + 1) {
      found = { expression: key.value, tokens: [i, end] };
    }
    i = cursor.is(end, ",") ? end + 1 : end;
  }
  return found;
}

function globalArgsOfOptions(
  cursor: Cursor,
  [start, end]: [number, number],
  declarations: Map<string, Declaration>,
  depth = 0,
): GlobalArgsCall | undefined {
  const first = cursor.at(start);
  if (!first) return undefined;
  if (first.value === "{") return globalArgsInObject(cursor, start);
  if (first.kind === "identifier" && end - start === 1 && depth < 4) {
    const declaration = declarations.get(first.value);
    if (!declaration) return undefined;
    const [declStart, declEnd] = declaration.tokens;
    const assign = cursor.tokens.findIndex(
      (token, index) => index >= declStart && index < declEnd && token.value === "=",
    );
    if (assign < 0) return undefined;
    return globalArgsOfOptions(cursor, [assign + 1, declEnd], declarations, depth + 1);
  }
  return undefined;
}

/**
 * Find the `runMain(command, { globalArgs })` calls in an entry module and the
 * top-level imports and declarations their `globalArgs` value may reference.
 */
export function analyzeEntry(source: string): EntryAnalysis {
  const tokens = tokenize(source);
  const cursor = new Cursor(source, tokens);
  const { imports, declarations } = parseTopLevel(cursor);
  const { names, namespaces } = runMainCallees(imports);
  const calls: GlobalArgsCall[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind !== "identifier") continue;
    const previous = tokens[i - 1]?.value;
    let open: number | undefined;
    if (names.has(token.value) && previous !== "." && previous !== "?." && cursor.is(i + 1, "(")) {
      open = i + 1;
    } else if (
      namespaces.has(token.value) &&
      cursor.is(i + 1, ".") &&
      cursor.is(i + 2, RUN_MAIN) &&
      cursor.is(i + 3, "(")
    ) {
      open = i + 3;
    }
    if (open === undefined) continue;
    const options = callArguments(cursor, open)[1];
    const found = options && globalArgsOfOptions(cursor, options, declarations);
    if (found) calls.push(found);
  }
  return { source, tokens, imports, declarations, calls };
}

/**
 * Names of the top-level imports and declarations the tokens in `range`
 * reference, followed transitively through the declarations.
 */
export function referencedBindings(
  analysis: EntryAnalysis,
  range: [number, number],
): { imports: ImportBinding[]; declarations: Declaration[] } {
  const imports = new Map<string, ImportBinding>();
  const declarations = new Map<string, Declaration>();
  const pending: [number, number][] = [range];
  while (pending.length > 0) {
    const [start, end] = pending.pop()!;
    for (let i = start; i < end; i++) {
      const token = analysis.tokens[i]!;
      if (token.kind !== "identifier") continue;
      const previous = analysis.tokens[i - 1];
      const next = analysis.tokens[i + 1];
      if (previous?.value === "." || previous?.value === "?.") continue;
      const isKey = (previous?.value === "{" || previous?.value === ",") && next?.value === ":";
      if (isKey) continue;
      const binding = analysis.imports.get(token.value);
      if (binding) {
        imports.set(token.value, binding);
        continue;
      }
      const declaration = analysis.declarations.get(token.value);
      if (declaration && !declarations.has(token.value)) {
        declarations.set(token.value, declaration);
        pending.push(declaration.tokens);
      }
    }
  }
  return {
    imports: [...imports.values()],
    declarations: [...declarations.values()].sort((a, b) => a.start - b.start),
  };
}
