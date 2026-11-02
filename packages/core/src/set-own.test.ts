import { describe, expect, it } from "vitest";
import { setOwn } from "./set-own.js";

describe("setOwn", () => {
  it("writes an ordinary key as an enumerable own property", () => {
    const target: Record<string, unknown> = {};

    setOwn(target, "name", 1);

    expect(Object.entries(target)).toEqual([["name", 1]]);
  });

  it("keeps __proto__ as an own property instead of replacing the prototype", () => {
    const target: Record<string, unknown> = {};

    setOwn(target, "__proto__", { polluted: true });

    expect(Object.hasOwn(target, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("overwrites a key that was already written", () => {
    const target: Record<string, unknown> = {};

    setOwn(target, "__proto__", 1);
    setOwn(target, "__proto__", 2);

    expect(Object.getOwnPropertyDescriptor(target, "__proto__")?.value).toBe(2);
  });
});
