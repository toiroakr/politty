import { describe, expect, it } from "vitest";
import {
  assertDeclaredKeys,
  getFieldValue,
  mergeNestedArgs,
  splitPath,
  unflattenRecord,
} from "./unflatten.js";

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

  it("should not follow inherited properties along the path", () => {
    const field = {
      name: "__proto__.constructor",
      nested: { path: ["__proto__", "constructor"] },
    };
    expect(getFieldValue({}, field)).toBeUndefined();
  });

  it("should read undefined when a group on the path is absent", () => {
    const field = { name: "db.host", nested: { path: ["db", "host"] } };
    expect(getFieldValue({}, field)).toBeUndefined();
  });
});

describe("assertDeclaredKeys", () => {
  it("should accept keys that do not collide", () => {
    expect(() => assertDeclaredKeys(["name", "db.host", "db.port"])).not.toThrow();
  });

  it("should throw a TypeError for a key that is both a value and a group", () => {
    expect(() => assertDeclaredKeys(["db", "db.host"])).toThrow(TypeError);
    expect(() => assertDeclaredKeys(["db.host", "db"])).toThrow(/"db" is both a value and a group/);
  });

  it("should throw for group names that differ only in kebab-case versus camelCase", () => {
    expect(() => assertDeclaredKeys(["server-config.host", "serverConfig.port"])).toThrow(
      /"server-config" and "serverConfig" are spellings of the same name/,
    );
  });

  it("should throw for a PascalCase group name that collides with a kebab-case one", () => {
    expect(() => assertDeclaredKeys(["ServerConfig.host", "server-config.port"])).toThrow(
      /are spellings of the same name/,
    );
  });

  it("should accept the same group spelled the same way in every key", () => {
    expect(() => assertDeclaredKeys(["server-config.host", "server-config.port"])).not.toThrow();
  });

  it("should split the keys by the given options", () => {
    expect(() =>
      assertDeclaredKeys(["db-host", "db"], { style: "kebab", prefixes: ["db"] }),
    ).toThrow(/"db" is both a value and a group/);
  });
});

describe("mergeNestedArgs", () => {
  const fields = (...paths: string[][]) => paths.map((path) => ({ nested: { path } }));

  it("should merge a group both schemas nest into and let the command win a shared key", () => {
    const merged = mergeNestedArgs(
      { config: { host: "gh", port: 1 } },
      { config: { port: 2 } },
      fields(["config", "host"], ["config", "port"]),
      fields(["config", "port"]),
    );

    expect(merged).toEqual({ config: { host: "gh", port: 2 } });
  });

  it("should keep symbol keys of both sides, as a spread merge does", () => {
    const token = Symbol("token");
    const other = Symbol("other");

    const merged = mergeNestedArgs({ [other]: 1, a: 1 }, { [token]: 2, b: 2 }, [], []) as Record<
      PropertyKey,
      unknown
    >;

    expect(merged[token]).toBe(2);
    expect(merged[other]).toBe(1);
  });

  it("should keep a __proto__ group as an own property", () => {
    const command = unflattenRecord({ "__proto__.enabled": true }, (key) => key.split("."));
    if (command.issues) throw new Error("expected a value");

    const merged = mergeNestedArgs({}, command.value, [], []);

    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.hasOwn(merged, "__proto__")).toBe(true);
    expect(Object.hasOwn(merged, "enabled")).toBe(false);
  });
});
