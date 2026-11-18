import { describe, expect, it } from "vitest";
import { parseJsonc } from "./jsonc.js";

describe("parseJsonc", () => {
  it("parses plain JSON", () => {
    expect(parseJsonc('{ "a": [1, true, null] }')).toEqual({ a: [1, true, null] });
  });

  it("ignores line comments", () => {
    expect(parseJsonc('{\n  // note\n  "a": 1 // trailing\n}')).toEqual({ a: 1 });
  });

  it("ignores block comments", () => {
    expect(parseJsonc('{ /* one\n two */ "a": /* inline */ 1 }')).toEqual({ a: 1 });
  });

  it("allows a trailing comma in an object", () => {
    expect(parseJsonc('{ "a": 1, }')).toEqual({ a: 1 });
  });

  it("allows a trailing comma in an array", () => {
    expect(parseJsonc('{ "a": [1, 2,\n] }')).toEqual({ a: [1, 2] });
  });

  it("keeps comment markers that appear inside a string", () => {
    expect(parseJsonc('{ "url": "https://example.com/*x*/", "b": "a,}" }')).toEqual({
      url: "https://example.com/*x*/",
      b: "a,}",
    });
  });

  it("keeps an escaped quote inside a string", () => {
    expect(parseJsonc(String.raw`{ "a": "say \"//hi\"" }`)).toEqual({ a: 'say "//hi"' });
  });

  it("ignores a byte order mark at the start", () => {
    expect(parseJsonc('\uFEFF{ "a": 1 }')).toEqual({ a: 1 });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJsonc("{ a: 1 }")).toThrow();
  });
});
