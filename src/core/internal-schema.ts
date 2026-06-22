import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Zero-dependency internal schema used to define politty's own built-in
 * commands (completion, skill, worker, ...).
 *
 * politty cannot use Zod for its built-in commands without forcing Zod into the
 * runtime of every CLI — including Valibot/ArkType ones — because the main
 * entrypoint re-exports those commands. It also cannot use Valibot/ArkType
 * without making those (and their JSON Schema converters) hard runtime
 * dependencies. So built-in commands use this tiny schema implementation
 * instead: it implements the {@link https://standardschema.dev/ Standard
 * Schema} `~standard.validate` interface (vendor `"politty"`) and is
 * introspected directly by the schema extractor — no JSON Schema conversion,
 * no third-party schema library, no Zod.
 *
 * It only supports the handful of features the built-in commands need:
 * objects of string / boolean / number / enum / array fields, with
 * `optional`, `default`, and `describe`.
 */

const VENDOR = "politty";

type FieldKind = "string" | "number" | "boolean" | "enum" | "array" | "object" | "record";

interface SchemaState {
  kind: FieldKind;
  optional: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
  description?: string | undefined;
  enumValues?: string[] | undefined;
  element?: InternalSchema | undefined;
  shape?: Record<string, InternalSchema> | undefined;
  /** String length constraints. */
  minLength?: number | undefined;
  maxLength?: number | undefined;
  /** String pattern constraint and its custom error message. */
  pattern?: RegExp | undefined;
  patternMessage?: string | undefined;
  /** Object: keep unknown keys instead of stripping them. */
  passthrough?: boolean | undefined;
  /** Record: schema applied to each value. */
  valueSchema?: InternalSchema | undefined;
}

type Issue = { message: string; path: (string | number)[] };

/** Zod-compatible `safeParse` result (the subset politty's internals consume). */
export type SafeParseResult<Output> =
  | { success: true; data: Output }
  | { success: false; error: { issues: Issue[] } };

/** A minimal, introspectable Standard Schema for politty's built-in commands. */
export class InternalSchema<Output = unknown> implements StandardSchemaV1<unknown, Output> {
  /** @internal */
  readonly state: SchemaState;
  readonly "~standard": StandardSchemaV1.Props<unknown, Output>;

  constructor(state: SchemaState) {
    this.state = state;
    this["~standard"] = {
      version: 1,
      vendor: VENDOR,
      validate: (value) => this.#validate(value),
    };
  }

  optional(): InternalSchema<Output | undefined> {
    return new InternalSchema<Output | undefined>({ ...this.state, optional: true });
  }

  default(value: Output): InternalSchema<Output> {
    return new InternalSchema<Output>({
      ...this.state,
      optional: true,
      hasDefault: true,
      defaultValue: value,
    });
  }

  describe(description: string): InternalSchema<Output> {
    return new InternalSchema<Output>({ ...this.state, description });
  }

  min(length: number): InternalSchema<Output> {
    return new InternalSchema<Output>({ ...this.state, minLength: length });
  }

  max(length: number): InternalSchema<Output> {
    return new InternalSchema<Output>({ ...this.state, maxLength: length });
  }

  regex(pattern: RegExp, options?: { message?: string }): InternalSchema<Output> {
    return new InternalSchema<Output>({
      ...this.state,
      pattern,
      patternMessage: options?.message,
    });
  }

  passthrough(): InternalSchema<Output> {
    return new InternalSchema<Output>({ ...this.state, passthrough: true });
  }

  /** Zod-compatible synchronous validation entry point. */
  safeParse(value: unknown): SafeParseResult<Output> {
    const issues: Issue[] = [];
    const out = validateNode(this.state, value, [], issues);
    if (issues.length > 0) return { success: false, error: { issues } };
    return { success: true, data: out as Output };
  }

  #validate(value: unknown): { value: Output; issues?: undefined } | { issues: readonly Issue[] } {
    const result = this.safeParse(value);
    if (result.success) return { value: result.data };
    return { issues: result.error.issues };
  }
}

function validateNode(
  state: SchemaState,
  value: unknown,
  path: (string | number)[],
  issues: Issue[],
): unknown {
  if (state.kind === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      issues.push({ message: "Expected an object", path });
      return value;
    }
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const known = new Set<string>();
    for (const [key, child] of Object.entries(state.shape ?? {})) {
      known.add(key);
      const raw = source[key];
      if (raw === undefined) {
        if (child.state.hasDefault) {
          result[key] = child.state.defaultValue;
        } else if (child.state.optional) {
          // omit absent optional values (no key)
        } else {
          issues.push({ message: `Missing required value: ${key}`, path: [...path, key] });
        }
        continue;
      }
      result[key] = validateNode(child.state, raw, [...path, key], issues);
    }
    // passthrough: preserve unknown keys instead of stripping them
    if (state.passthrough) {
      for (const [key, raw] of Object.entries(source)) {
        if (!known.has(key)) result[key] = raw;
      }
    }
    return result;
  }

  if (state.kind === "record") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      issues.push({ message: "Expected an object", path });
      return value;
    }
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(source)) {
      result[key] = state.valueSchema
        ? validateNode(state.valueSchema.state, raw, [...path, key], issues)
        : raw;
    }
    return result;
  }

  switch (state.kind) {
    case "enum":
      if (typeof value !== "string" || !(state.enumValues ?? []).includes(value)) {
        issues.push({
          message: `Expected one of: ${(state.enumValues ?? []).join(", ")}`,
          path,
        });
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") {
        issues.push({ message: "Expected a boolean", path });
      }
      return value;
    case "number":
      if (typeof value !== "number") {
        issues.push({ message: "Expected a number", path });
      }
      return value;
    case "string":
      if (typeof value !== "string") {
        issues.push({ message: "Expected a string", path });
        return value;
      }
      if (state.minLength !== undefined && value.length < state.minLength) {
        issues.push({
          message: `Must be at least ${state.minLength} character(s)`,
          path,
        });
      }
      if (state.maxLength !== undefined && value.length > state.maxLength) {
        issues.push({
          message: `Must be at most ${state.maxLength} character(s)`,
          path,
        });
      }
      if (state.pattern && !state.pattern.test(value)) {
        issues.push({ message: state.patternMessage ?? "Invalid format", path });
      }
      return value;
    case "array": {
      if (!Array.isArray(value)) {
        issues.push({ message: "Expected an array", path });
        return value;
      }
      if (state.element) {
        return value.map((item, i) =>
          validateNode(state.element!.state, item, [...path, i], issues),
        );
      }
      return value;
    }
    default:
      return value;
  }
}

type Infer<S> = S extends InternalSchema<infer O> ? O : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Infer an object output type from a shape, making fields whose output includes
 * `undefined` (i.e. `.optional()` without a default) optional keys — mirroring
 * Zod's `z.infer` so existing consumers keep their `key?:` shapes.
 */
type InferShape<Shape extends Record<string, InternalSchema>> = Simplify<
  {
    [K in keyof Shape as undefined extends Infer<Shape[K]> ? never : K]: Infer<Shape[K]>;
  } & {
    [K in keyof Shape as undefined extends Infer<Shape[K]> ? K : never]?: Infer<Shape[K]>;
  }
>;

/** Builders for the internal schema (mirrors the small subset of the Zod API used internally). */
export const s = {
  string(): InternalSchema<string> {
    return new InternalSchema<string>({ kind: "string", optional: false, hasDefault: false });
  },
  number(): InternalSchema<number> {
    return new InternalSchema<number>({ kind: "number", optional: false, hasDefault: false });
  },
  boolean(): InternalSchema<boolean> {
    return new InternalSchema<boolean>({ kind: "boolean", optional: false, hasDefault: false });
  },
  enum<const T extends readonly string[]>(values: T): InternalSchema<T[number]> {
    return new InternalSchema<T[number]>({
      kind: "enum",
      optional: false,
      hasDefault: false,
      enumValues: [...values],
    });
  },
  array<E>(element: InternalSchema<E>): InternalSchema<E[]> {
    return new InternalSchema<E[]>({
      kind: "array",
      optional: false,
      hasDefault: false,
      element,
    });
  },
  record<E>(valueSchema: InternalSchema<E>): InternalSchema<Record<string, E>> {
    return new InternalSchema<Record<string, E>>({
      kind: "record",
      optional: false,
      hasDefault: false,
      valueSchema,
    });
  },
  object<Shape extends Record<string, InternalSchema>>(
    shape: Shape,
  ): InternalSchema<InferShape<Shape>> {
    return new InternalSchema<InferShape<Shape>>({
      kind: "object",
      optional: false,
      hasDefault: false,
      shape,
    });
  },
};

export type { Infer as InferInternal };
