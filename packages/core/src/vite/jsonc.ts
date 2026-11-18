function endOfString(text: string, start: number): number {
  let end = start + 1;
  while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
  return end + 1;
}

function stripComments(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    const next = text[index + 1];
    if (char === '"') {
      const end = endOfString(text, index);
      out += text.slice(index, end);
      index = end;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") index += 1;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end === -1) throw new SyntaxError("Unterminated block comment");
      out += " ";
      index = end + 2;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

function dropTrailingCommas(text: string): string {
  let out = "";
  let previous = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '"') {
      const end = endOfString(text, index);
      out += text.slice(index, end);
      previous = '"';
      index = end;
    } else if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead]!)) lookahead += 1;
      const closes = text[lookahead] === "}" || text[lookahead] === "]";
      const afterElement = previous !== "" && !"{[,".includes(previous);
      if (!(closes && afterElement)) out += char;
      previous = char;
      index += 1;
    } else {
      out += char;
      if (!/\s/.test(char)) previous = char;
      index += 1;
    }
  }
  return out;
}

export function parseJsonc(text: string): unknown {
  return JSON.parse(dropTrailingCommas(stripComments(text.replace(/^\uFEFF/, ""))));
}
