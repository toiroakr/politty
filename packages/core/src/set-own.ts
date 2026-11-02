// Assignment is not used: `target["__proto__"] = value` hits the prototype
// setter, so a user-supplied key of that name would be lost or change the prototype.
export function setOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
