export type TokenKind = "identifier" | "string" | "template" | "number" | "regex" | "punctuator";

export interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
}

const IDENTIFIER_START = /[\p{ID_Start}$_]/u;
const IDENTIFIER_PART = /[\p{ID_Continue}$‌‍]/u;
const PUNCTUATORS = [
  ">>>=",
  "...",
  "===",
  "!==",
  "**=",
  "<<=",
  ">>=",
  "&&=",
  "||=",
  "??=",
  ">>>",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "**",
  "<<",
  ">>",
];
const KEYWORDS_BEFORE_EXPRESSION = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

function regexAllowedAfter(previous: Token | undefined): boolean {
  if (!previous) return true;
  if (previous.kind === "identifier") return KEYWORDS_BEFORE_EXPRESSION.has(previous.value);
  if (previous.kind === "punctuator") return ![")", "]", "}", "++", "--"].includes(previous.value);
  return false;
}

function skipQuoted(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length && source[index] !== quote) {
    if (source[index] === "\\") index++;
    else if (source[index] === "\n") break;
    index++;
  }
  return index + 1;
}

function skipRegex(source: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < source.length && source[index] !== "\n") {
    const char = source[index];
    if (char === "\\") index++;
    else if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) break;
    index++;
  }
  index++;
  while (index < source.length && IDENTIFIER_PART.test(source[index]!)) index++;
  return index;
}

/**
 * Scan the template literal part that starts at `start` (a backtick or the
 * `}` closing a substitution), up to and including the backtick or `${` that
 * ends it.
 */
function skipTemplatePart(source: string, start: number): { end: number; closed: boolean } {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") index += 2;
    else if (char === "`") return { end: index + 1, closed: true };
    else if (char === "$" && source[index + 1] === "{") return { end: index + 2, closed: false };
    else index++;
  }
  return { end: index, closed: true };
}

/**
 * Split TypeScript source into tokens, dropping whitespace and comments.
 * Template literals come out as one token per literal part, with the
 * substitutions between them tokenized as usual.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const templateDepths: number[] = [];
  let braceDepth = 0;
  let index = 0;
  const push = (kind: TokenKind, start: number, end: number) => {
    tokens.push({ kind, value: source.slice(start, end), start, end });
    index = end;
  };

  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      index++;
    } else if (source.startsWith("//", index)) {
      const lineEnd = source.indexOf("\n", index);
      index = lineEnd < 0 ? source.length : lineEnd;
    } else if (source.startsWith("/*", index)) {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd < 0 ? source.length : commentEnd + 2;
    } else if (char === '"' || char === "'") {
      push("string", index, Math.min(skipQuoted(source, index), source.length));
    } else if (char === "`") {
      const part = skipTemplatePart(source, index);
      if (!part.closed) templateDepths.push(braceDepth);
      push("template", index, part.end);
    } else if (char === "}" && templateDepths.at(-1) === braceDepth) {
      templateDepths.pop();
      const part = skipTemplatePart(source, index);
      if (!part.closed) templateDepths.push(braceDepth);
      push("template", index, part.end);
    } else if (IDENTIFIER_START.test(char) || char === "#") {
      let end = index + 1;
      while (end < source.length && IDENTIFIER_PART.test(source[end]!)) end++;
      push("identifier", index, end);
    } else if (/\d/.test(char) || (char === "." && /\d/.test(source[index + 1] ?? ""))) {
      let end = index + 1;
      while (end < source.length && /[\w.]/.test(source[end]!)) end++;
      push("number", index, end);
    } else if (char === "/" && regexAllowedAfter(tokens.at(-1))) {
      push("regex", index, Math.min(skipRegex(source, index), source.length));
    } else {
      const punctuator = PUNCTUATORS.find((candidate) => source.startsWith(candidate, index));
      const value = punctuator ?? char;
      if (value === "{") braceDepth++;
      else if (value === "}") braceDepth--;
      push("punctuator", index, index + value.length);
    }
  }
  return tokens;
}
