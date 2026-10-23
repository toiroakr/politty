/**
 * Shared pieces of the `unflatten` helpers: a schema declares flat keys such
 * as `"db.host"`, and the helper nests only its validated output. Option
 * names, `arg()` metadata and issue paths stay flat; these functions give the
 * nested position of each key for the helpers and for reading values back.
 *
 * The key splitting and the conflict rules follow loculus's `unflatten`.
 */

export type UnflattenStyle = "dot" | "kebab" | "camel";

export type UnflattenOptions =
  | { readonly style?: "dot" }
  | { readonly style: "kebab" | "camel"; readonly prefixes: readonly string[] };

// The output type below is ported from loculus's `Unflatten`; core does not
// depend on loculus, so the helpers of every adapter share this copy.
type PrefixRest<K, St, H extends string> = St extends "kebab"
  ? K extends `${H}-${infer R}`
    ? R
    : never
  : K extends `${H}${infer C}${infer R}`
    ? C extends Lowercase<C>
      ? never
      : `${Lowercase<C>}${R}`
    : never;
type MatchingPrefixes<K, St, P extends string> = P extends unknown
  ? [PrefixRest<K, St, P>] extends [never]
    ? never
    : P
  : never;
type ShortestPrefix<M extends string, St, All extends string = M> = M extends unknown
  ? [MatchingPrefixes<M, St, Exclude<All, M>>] extends [never]
    ? M
    : never
  : never;
type KeyHead<K, St, P extends string> = St extends "dot"
  ? K extends `${infer H}.${string}`
    ? H
    : never
  : ShortestPrefix<MatchingPrefixes<K, St, P>, St>;
type KeyRest<K, St, H extends string> = St extends "dot"
  ? K extends `${H}.${infer R}`
    ? R
    : never
  : PrefixRest<K, St, H>;
type UnflattenGroup<T, St, P extends string, H extends string> = {
  [K in keyof T as [KeyHead<K, St, P>] extends [H] ? KeyRest<K, St, H> : never]: T[K];
};
type UnflattenHeads<T, St, P extends string> = { [K in keyof T]-?: KeyHead<K, St, P> }[keyof T];
type StringKeys<T> = { [K in keyof T as K extends number ? `${K}` : K]: T[K] };
type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
type HasPatternKey<T> = true extends {
  [K in keyof T]-?: object extends Record<K, 1> ? true : false;
}[keyof T]
  ? true
  : false;
type UnflattenLevel<T, St, P extends string> =
  HasPatternKey<T> extends true ? Record<string, unknown> : UnflattenKeys<StringKeys<T>, St, P>;
type UnflattenKeys<T, St, P extends string> = (
  UnflattenHeads<T, St, P> extends infer Heads extends string
    ? {
        [
          K in keyof T as K extends symbol
            ? never
            : [KeyHead<K, St, P>] extends [never]
              ? K extends Heads
                ? never
                : K
              : never
        ]: T[K];
      } & { [H in Heads & keyof T]?: unknown } & {
        [
          H in Exclude<Heads, keyof T> as object extends UnflattenGroup<T, St, P, H & string>
            ? never
            : H
        ]: UnflattenLevel<UnflattenGroup<T, St, P, H & string>, St, PrefixRest<P, St, H & string>>;
      } & {
        [
          H in Exclude<Heads, keyof T> as object extends UnflattenGroup<T, St, P, H & string>
            ? H
            : never
        ]?: UnflattenLevel<UnflattenGroup<T, St, P, H & string>, St, PrefixRest<P, St, H & string>>;
      }
    : never
) extends infer X
  ? { [K in keyof X]: X[K] }
  : never;
type UnflattenPrefixed<T, St, A extends readonly string[]> = A extends unknown
  ? number extends A["length"]
    ? Record<string, unknown>
    : string extends A[number]
      ? Record<string, unknown>
      : true extends { [I in keyof A]: IsUnion<A[I]> }[number]
        ? Record<string, unknown>
        : UnflattenLevel<T, St, A[number]>
  : never;
type UnflattenWith<T, O> = O extends unknown
  ? (O extends { readonly style?: infer St } ? St : "dot") extends infer St
    ? St extends "kebab" | "camel"
      ? O extends { readonly prefixes: infer A extends readonly string[] }
        ? UnflattenPrefixed<T, St, A>
        : Record<string, unknown>
      : UnflattenLevel<T, "dot", never>
    : never
  : never;

/** The nested output type of a flat record `T` under the given options */
export type Unflatten<T, O extends UnflattenOptions = { style: "dot" }> = T extends unknown
  ? UnflattenWith<T, O>
  : never;

/** Where a flat field's value sits in the nested output */
export interface NestedFieldInfo {
  path: readonly string[];
}

export interface UnflattenIssue {
  message: string;
  path: string[];
}

export type UnflattenResult =
  | { value: Record<string, unknown>; issues?: undefined }
  | { issues: UnflattenIssue[]; value?: undefined };

function splitPrefix(key: string, style: UnflattenStyle, prefix: string): string | undefined {
  if (key.length <= prefix.length || !key.startsWith(prefix)) return undefined;
  if (style === "kebab") {
    return key[prefix.length] === "-" ? key.slice(prefix.length + 1) : undefined;
  }
  const first = key[prefix.length]!;
  return first === first.toLowerCase()
    ? undefined
    : first.toLowerCase() + key.slice(prefix.length + 1);
}

function splitKey(
  key: string,
  style: UnflattenStyle,
  prefixes: readonly string[],
): [string, string] | undefined {
  if (style === "dot") {
    const index = key.indexOf(".");
    return index < 0 ? undefined : [key.slice(0, index), key.slice(index + 1)];
  }
  let head: string | undefined;
  for (const prefix of prefixes) {
    if (
      splitPrefix(key, style, prefix) !== undefined &&
      (head === undefined || prefix.length < head.length)
    ) {
      head = prefix;
    }
  }
  return head === undefined ? undefined : [head, splitPrefix(key, style, head)!];
}

/**
 * Split a flat key into the path of its nested position.
 *
 * `dot` splits at every dot. `kebab` and `camel` split only after a listed
 * prefix, so `dry-run` and `dbx` stay whole; going one level down narrows the
 * prefixes to the ones under the head just taken, so `db` and `db-pool`
 * nest as `db` then `pool`.
 */
export function splitPath(
  key: string,
  style: UnflattenStyle,
  prefixes: readonly string[],
): string[] {
  if (style === "dot") return key.split(".");
  const path: string[] = [];
  let rest = key;
  for (
    let split = splitKey(rest, style, prefixes);
    split;
    split = splitKey(rest, style, prefixes)
  ) {
    const name = split[0];
    path.push(name);
    rest = split[1];
    prefixes = prefixes.flatMap((prefix) => splitPrefix(prefix, style, name) ?? []);
  }
  path.push(rest);
  return path;
}

/** The nested position of a key, as the helper built with these options gives it */
export function pathResolver(options: UnflattenOptions = {}): (key: string) => string[] {
  const style = options.style ?? "dot";
  const prefixes = "prefixes" in options ? options.prefixes : [];
  return (key) => splitPath(key, style, prefixes);
}

// `target[key] = value` on `__proto__` would set the prototype instead of
// adding a property, so a schema key named `__proto__` could not be kept.
function assignValue(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}

/**
 * Nest the keys of a flat record by their paths. A group exists only when one
 * of its keys is present. A key that is both a value and a group (`db` and
 * `db.host`) is reported as an issue at the flat key.
 */
export function unflattenRecord(
  value: Record<string, unknown>,
  pathOf: (key: string) => readonly string[],
): UnflattenResult {
  const output: Record<string, unknown> = {};
  const groups = new Set<unknown>();
  const conflict = (source: string, name: string): UnflattenResult => ({
    issues: [
      {
        message: `Cannot unflatten "${source}": "${name}" is both a value and a group`,
        path: [source],
      },
    ],
  });
  for (const source of Object.keys(value)) {
    const path = pathOf(source);
    const last = path.length - 1;
    let target = output;
    for (let index = 0; index < last; index++) {
      const name = path[index]!;
      if (Object.hasOwn(target, name)) {
        const group = target[name];
        if (!groups.has(group)) return conflict(source, name);
        target = group as Record<string, unknown>;
      } else {
        const group: Record<string, unknown> = {};
        groups.add(group);
        assignValue(target, name, group);
        target = group;
      }
    }
    const leaf = path[last]!;
    if (Object.hasOwn(target, leaf)) return conflict(source, leaf);
    assignValue(target, leaf, value[source]);
  }
  return { value: output };
}

const registry = new WeakMap<object, UnflattenOptions>();

/**
 * Record that a schema is the output of an `unflatten` helper, so field
 * extraction can tell where each flat field's value sits in the output.
 * Keyed by schema identity, like `arg()` metadata.
 */
export function registerUnflatten<T extends object>(schema: T, options: UnflattenOptions = {}): T {
  registry.set(schema, options);
  return schema;
}

export function getUnflattenOptions(schema: object): UnflattenOptions | undefined {
  return registry.get(schema);
}

/**
 * Read a field's value from validated args, following its nested path when
 * its schema was wrapped by an `unflatten` helper.
 */
export function getFieldValue(
  args: Record<string, unknown>,
  field: { name: string; nested?: NestedFieldInfo | undefined },
): unknown {
  if (!field.nested) return args[field.name];
  let value: unknown = args;
  for (const key of field.nested.path) {
    value =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  return value;
}
