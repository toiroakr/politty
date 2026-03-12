import { describe, expect, it } from "vitest";

import { createDualCaseProxy } from "./case-proxy.js";

describe("createDualCaseProxy", () => {
  it("accesses kebab-case key via camelCase", () => {
    const obj = createDualCaseProxy({ "my-option": "value" });
    expect((obj as Record<string, unknown>).myOption).toBe("value");
  });

  it("accesses camelCase key via kebab-case", () => {
    const obj = createDualCaseProxy({ myOption: "value" });
    expect((obj as Record<string, unknown>)["my-option"]).toBe("value");
  });

  it("accesses original keys directly", () => {
    const obj = createDualCaseProxy({ "my-option": "kebab", myOther: "camel" });
    expect(obj["my-option"]).toBe("kebab");
    expect(obj.myOther).toBe("camel");
  });

  it("returns undefined for non-existent keys", () => {
    const obj = createDualCaseProxy({ "my-option": "value" });
    expect((obj as Record<string, unknown>).nonExistent).toBeUndefined();
  });

  it("detects both case variants with 'in' operator", () => {
    const obj = createDualCaseProxy({ "my-option": "value" });
    expect("my-option" in obj).toBe(true);
    expect("myOption" in obj).toBe(true);
    expect("nonExistent" in obj).toBe(false);
  });

  it("detects camelCase key via kebab-case with 'in' operator", () => {
    const obj = createDualCaseProxy({ myOption: "value" });
    expect("myOption" in obj).toBe(true);
    expect("my-option" in obj).toBe(true);
  });

  it("returns only original keys from Object.keys()", () => {
    const obj = createDualCaseProxy({ "my-option": "a", myOther: "b" });
    expect(Object.keys(obj)).toEqual(["my-option", "myOther"]);
  });

  it("handles single-word keys unchanged", () => {
    const obj = createDualCaseProxy({ verbose: true });
    expect(obj.verbose).toBe(true);
    expect("verbose" in obj).toBe(true);
  });

  it("handles multi-hyphen kebab-case", () => {
    const obj = createDualCaseProxy({ "my-long-option": 42 });
    expect((obj as Record<string, unknown>).myLongOption).toBe(42);
  });

  it("preserves non-string property access (symbols)", () => {
    const sym = Symbol("test");
    const obj = createDualCaseProxy({ [sym]: "sym-value", key: "val" } as Record<string, unknown>);
    expect((obj as Record<symbol, unknown>)[sym]).toBe("sym-value");
  });
});
