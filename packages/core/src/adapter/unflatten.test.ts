import { describe, expect, it } from "vitest";
import { getFieldValue, splitPath, unflattenRecord } from "./unflatten.js";

describe("splitPath", () => {
  it("should split a dotted key at every dot", () => {
    expect(splitPath("db.pool.max", "dot", [])).toEqual(["db", "pool", "max"]);
  });

  it("should leave a key without a dot as one segment", () => {
    expect(splitPath("verbose", "dot", [])).toEqual(["verbose"]);
  });

  it("should split a kebab-case key only after the listed prefixes", () => {
    const prefixes = ["db", "db-pool"];
    expect(splitPath("db-pool-max", "kebab", prefixes)).toEqual(["db", "pool", "max"]);
    expect(splitPath("db-host", "kebab", prefixes)).toEqual(["db", "host"]);
    expect(splitPath("dry-run", "kebab", prefixes)).toEqual(["dry-run"]);
  });

  it("should split a camelCase key only after the listed prefixes", () => {
    const prefixes = ["db", "dbPool"];
    expect(splitPath("dbPoolMax", "camel", prefixes)).toEqual(["db", "pool", "max"]);
    expect(splitPath("dbHostName", "camel", prefixes)).toEqual(["db", "hostName"]);
    expect(splitPath("dbx", "camel", prefixes)).toEqual(["dbx"]);
  });
});

describe("unflattenRecord", () => {
  const dot = (key: string) => splitPath(key, "dot", []);

  it("should nest each key under the groups of its path", () => {
    const result = unflattenRecord({ "db.host": "localhost", "db.port": 5432, name: "app" }, dot);
    expect(result).toEqual({ value: { db: { host: "localhost", port: 5432 }, name: "app" } });
  });

  it("should create a group only when one of its keys is present", () => {
    expect(unflattenRecord({ name: "app" }, dot)).toEqual({ value: { name: "app" } });
  });

  it("should report a key that is both a value and a group", () => {
    const valueFirst = unflattenRecord({ db: "x", "db.host": "y" }, dot);
    const groupFirst = unflattenRecord({ "db.host": "y", db: "x" }, dot);
    for (const result of [valueFirst, groupFirst]) {
      expect(result).toMatchObject({
        issues: [{ message: expect.stringContaining('"db" is both a value and a group') }],
      });
    }
  });

  it("should write a __proto__ key as an own property", () => {
    const result = unflattenRecord({ "a.__proto__": 1 }, dot);
    if (result.issues) throw new Error("expected a value");
    const group = result.value.a as Record<string, unknown>;
    expect(Object.getPrototypeOf(group)).toBe(Object.prototype);
    expect(Object.hasOwn(group, "__proto__")).toBe(true);
  });
});

describe("getFieldValue", () => {
  it("should read a top-level field by its name", () => {
    expect(getFieldValue({ verbose: true }, { name: "verbose" })).toBe(true);
  });

  it("should read a nested field at its path", () => {
    const field = { name: "db.host", nested: { path: ["db", "host"] } };
    expect(getFieldValue({ db: { host: "localhost" } }, field)).toBe("localhost");
  });

  it("should read undefined when a group on the path is absent", () => {
    const field = { name: "db.host", nested: { path: ["db", "host"] } };
    expect(getFieldValue({}, field)).toBeUndefined();
  });
});
