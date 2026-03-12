import { toCamelCase, toKebabCase } from "./schema-extractor.js";

/**
 * Wrap an args object with a Proxy that allows dual-case access.
 *
 * Given `{ "my-option": "value" }`, both `obj["my-option"]` and `obj.myOption`
 * will return `"value"`.
 *
 * - `Object.keys()`, `JSON.stringify()`, and spread return only the original keys.
 * - The `in` operator detects both case variants.
 */
export function createDualCaseProxy<T extends Record<string, unknown>>(obj: T): T {
  return new Proxy(obj, {
    get(target, prop, receiver) {
      if (typeof prop === "string") {
        if (prop in target) return Reflect.get(target, prop, receiver);
        const camel = toCamelCase(prop);
        if (camel !== prop && camel in target) return Reflect.get(target, camel, receiver);
        const kebab = toKebabCase(prop);
        if (kebab !== prop && kebab in target) return Reflect.get(target, kebab, receiver);
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === "string") {
        if (prop in target) return true;
        const camel = toCamelCase(prop);
        if (camel !== prop && camel in target) return true;
        const kebab = toKebabCase(prop);
        if (kebab !== prop && kebab in target) return true;
      }
      return Reflect.has(target, prop);
    },
  }) as T;
}
