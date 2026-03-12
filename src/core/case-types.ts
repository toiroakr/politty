/**
 * TypeScript utility types for case conversion between camelCase and kebab-case.
 *
 * These types enable dual-case access on CLI args objects,
 * so that both `args.myOption` and `args["my-option"]` are valid.
 */

/**
 * Convert a kebab-case string to camelCase at the type level.
 *
 * @example
 * type R = CamelCase<"my-option">; // "myOption"
 * type R2 = CamelCase<"already">; // "already"
 */
export type CamelCase<S extends string> = S extends `${infer P}-${infer C}${infer R}`
  ? `${P}${Uppercase<C>}${CamelCase<R>}`
  : S;

/**
 * Internal helper: insert hyphens before uppercase-to-lowercase transitions.
 * Matches the runtime `toKebabCase()` behavior:
 * - `([a-z])([A-Z])` → insert hyphen (e.g. "myOption" → "my-Option")
 * - `([A-Z]+)([A-Z][a-z])` → insert hyphen before last capital in a run
 *   (e.g. "XMLParser" → "XML-Parser" → "xml-parser")
 *
 * Note: TypeScript template literal types have limited ability to match
 * multi-character uppercase runs precisely. This implementation handles
 * common CLI naming patterns (camelCase, PascalCase). For exotic acronym
 * patterns (e.g. "XMLParser"), the type-level result may differ slightly
 * from the runtime result. Dual-case proxy handles runtime resolution.
 */
type KebabCaseInner<S extends string> = S extends `${infer First}${infer Rest}`
  ? Rest extends ""
    ? First extends Lowercase<First>
      ? First
      : `-${Lowercase<First>}`
    : First extends Lowercase<First>
      ? `${First}${KebabCaseInner<Rest>}`
      : Rest extends `${infer Next}${infer Tail}`
        ? Next extends Lowercase<Next>
          ? `-${Lowercase<First>}${Next}${KebabCaseInner<Tail>}`
          : `${Lowercase<First>}${KebabCaseInner<Rest>}`
        : `-${Lowercase<First>}`
  : S;

/**
 * Strip a leading hyphen (produced when the first char is uppercase).
 */
type StripLeadingHyphen<S extends string> = S extends `-${infer R}` ? R : S;

/**
 * Convert a camelCase string to kebab-case at the type level.
 * Aligned with the runtime `toKebabCase()` function in schema-extractor.ts.
 *
 * @example
 * type R = KebabCase<"myOption">; // "my-option"
 * type R2 = KebabCase<"already">; // "already"
 */
export type KebabCase<S extends string> = StripLeadingHyphen<KebabCaseInner<S>>;

/**
 * Add both camelCase and kebab-case variants for every key in T.
 *
 * Given `{ "my-option": string }`, produces
 * `{ "my-option": string } & { myOption: string }`.
 *
 * Given `{ myOption: string }`, produces
 * `{ myOption: string } & { "my-option": string }`.
 *
 * Keys that are identical in both cases (e.g. single-word keys) are not duplicated.
 * Uses a distributive conditional type so it works correctly with discriminated unions.
 */
export type WithCaseVariants<T> = T extends unknown
  ? T & {
      [K in keyof T as CamelCase<K & string>]: T[K];
    } & {
      [K in keyof T as KebabCase<K & string>]: T[K];
    }
  : never;
