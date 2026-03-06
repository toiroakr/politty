import { toCamelCase, type ExtractedFields } from "../core/schema-extractor.js";

/**
 * Parsed arguments result
 */
export interface ParsedArgv {
  /** Named options (--flag, -f) */
  options: Record<string, unknown>;
  /** Positional arguments */
  positionals: string[];
  /** Arguments after -- */
  rest: string[];
}

/**
 * Parser options
 */
export interface ParserOptions {
  /** Alias map (short -> long) */
  aliasMap?: Map<string, string>;
  /** Boolean flags (no value expected) */
  booleanFlags?: Set<string>;
  /** Array flags (can be repeated) */
  arrayFlags?: Set<string>;
  /**
   * All known canonical option names (as defined in the schema).
   * Used to disambiguate negation: when `--no-flag` or `--noFlag` matches
   * a name in this set, it is treated as a regular option rather than
   * boolean negation of `flag`.
   */
  definedNames?: Set<string>;
}

/**
 * Parse argv into a flat record
 *
 * Supports:
 * - Long options: --flag, --flag=value, --flag value
 * - Short options: -f, -f=value, -f value
 * - Combined short options: -abc (treated as -a -b -c if all are boolean)
 * - Positional arguments
 * - -- to stop parsing options
 * - Boolean negation: --no-flag, --noFlag (requires `booleanFlags`)
 *
 * **Note:** When using negation detection (`--noFlag` / `--no-flag`),
 * supply `definedNames` so that options whose names happen to start with
 * "no" (e.g. `noDryRun`) are not mistaken for negation of another flag.
 * Without `definedNames`, all `--noX` forms matching a boolean flag will
 * be treated as negation.
 *
 * @param argv - Command line arguments
 * @param options - Parser options
 * @returns Parsed arguments
 */
export function parseArgv(argv: string[], options: ParserOptions = {}): ParsedArgv {
  const {
    aliasMap = new Map(),
    booleanFlags = new Set(),
    arrayFlags = new Set(),
    definedNames = new Set(),
  } = options;

  const result: ParsedArgv = {
    options: {},
    positionals: [],
    rest: [],
  };

  let i = 0;
  let stopParsing = false;

  const setOption = (name: string, value: unknown) => {
    // Resolve alias
    const resolvedName = aliasMap.get(name) ?? name;

    if (arrayFlags.has(resolvedName)) {
      // Array flag: accumulate values
      const existing = result.options[resolvedName];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else if (existing !== undefined) {
        result.options[resolvedName] = [existing, value];
      } else {
        result.options[resolvedName] = [value];
      }
    } else {
      result.options[resolvedName] = value;
    }
  };

  while (i < argv.length) {
    const arg = argv[i]!;

    // Stop parsing after --
    if (stopParsing) {
      result.rest.push(arg);
      i++;
      continue;
    }

    // Check for --
    if (arg === "--") {
      stopParsing = true;
      i++;
      continue;
    }

    // Long option: --flag or --flag=value
    if (arg.startsWith("--")) {
      const withoutDashes = arg.slice(2);

      // Handle --no-flag for boolean negation (kebab-case only)
      if (withoutDashes.startsWith("no-")) {
        const flagName = withoutDashes.slice(3);
        // Block mixed form: --no-dryRun (kebab prefix + camelCase)
        if (flagName === flagName.toLowerCase()) {
          const resolvedName = aliasMap.get(flagName) ?? flagName;
          if (booleanFlags.has(resolvedName)) {
            // "no-dry-run" itself is a defined field → treat as that field, not negation
            const asIsResolved = aliasMap.get(withoutDashes) ?? withoutDashes;
            if (!definedNames.has(asIsResolved)) {
              setOption(flagName, false);
              i++;
              continue;
            }
          }
        }
      }

      // Handle camelCase negation: --noDryRun -> dryRun = false
      if (
        withoutDashes.length > 2 &&
        withoutDashes.startsWith("no") &&
        /[A-Z]/.test(withoutDashes[2]!)
      ) {
        const camelFlagName = withoutDashes[2]!.toLowerCase() + withoutDashes.slice(3);
        const resolvedName = aliasMap.get(camelFlagName) ?? camelFlagName;
        if (booleanFlags.has(resolvedName)) {
          // "noDryRun" itself is a defined field → treat as that field, not negation
          const asIsResolved = aliasMap.get(withoutDashes) ?? withoutDashes;
          if (!definedNames.has(asIsResolved)) {
            setOption(camelFlagName, false);
            i++;
            continue;
          }
        }
      }

      const eqIndex = withoutDashes.indexOf("=");
      if (eqIndex !== -1) {
        // --flag=value
        const name = withoutDashes.slice(0, eqIndex);
        const value = withoutDashes.slice(eqIndex + 1);
        setOption(name, value);
        i++;
      } else {
        // --flag or --flag value
        const name = withoutDashes;
        const resolvedName = aliasMap.get(name) ?? name;

        if (booleanFlags.has(resolvedName)) {
          // Boolean flag: no value expected
          setOption(name, true);
          i++;
        } else {
          // Check if next arg is a value
          const nextArg = argv[i + 1];
          if (nextArg !== undefined && !nextArg.startsWith("-")) {
            setOption(name, nextArg);
            i += 2;
          } else {
            // No value provided, treat as true
            setOption(name, true);
            i++;
          }
        }
      }
      continue;
    }

    // Short option: -f or -f=value or -abc
    if (arg.startsWith("-") && arg.length > 1 && !arg.startsWith("--")) {
      const withoutDash = arg.slice(1);

      const eqIndex = withoutDash.indexOf("=");
      if (eqIndex !== -1) {
        // -f=value
        const name = withoutDash.slice(0, eqIndex);
        const value = withoutDash.slice(eqIndex + 1);
        setOption(name, value);
        i++;
      } else if (withoutDash.length === 1) {
        // Single short option: -f
        const name = withoutDash;
        const resolvedName = aliasMap.get(name) ?? name;

        if (booleanFlags.has(resolvedName)) {
          setOption(name, true);
          i++;
        } else {
          // Check if next arg is a value
          const nextArg = argv[i + 1];
          if (nextArg !== undefined && !nextArg.startsWith("-")) {
            setOption(name, nextArg);
            i += 2;
          } else {
            setOption(name, true);
            i++;
          }
        }
      } else {
        // Combined short options: -abc
        // Treat each character as a boolean flag
        for (const char of withoutDash) {
          setOption(char, true);
        }
        i++;
      }
      continue;
    }

    // Positional argument
    result.positionals.push(arg);
    i++;
  }

  return result;
}

/**
 * Build parser options from extracted fields
 */
export function buildParserOptions(extracted: ExtractedFields): ParserOptions {
  const aliasMap = new Map<string, string>();
  const booleanFlags = new Set<string>();
  const arrayFlags = new Set<string>();
  const definedNames = new Set<string>();

  // First pass: collect all canonical field names
  for (const field of extracted.fields) {
    definedNames.add(field.name);
  }

  for (const field of extracted.fields) {
    // Map kebab-case CLI name to camelCase field name
    // e.g., "dry-run" → "dryRun"
    if (field.cliName !== field.name) {
      aliasMap.set(field.cliName, field.name);
    }

    if (field.alias) {
      aliasMap.set(field.alias, field.name);
    }

    // Map camelCase variant to field name for kebab-case field names
    // e.g., field "dry-run" → aliasMap("dryRun", "dry-run")
    // Only add if it doesn't collide with any existing field name or already-registered alias
    const camelVariant = toCamelCase(field.name);
    if (
      camelVariant !== field.name &&
      !definedNames.has(camelVariant) &&
      !aliasMap.has(camelVariant)
    ) {
      aliasMap.set(camelVariant, field.name);
    }

    if (field.type === "boolean") {
      booleanFlags.add(field.name);
    }

    if (field.type === "array") {
      arrayFlags.add(field.name);
    }
  }

  return { aliasMap, booleanFlags, arrayFlags, definedNames };
}

/**
 * Merge parsed argv with positional fields to create a flat record
 */
export function mergeWithPositionals(
  parsed: ParsedArgv,
  extracted: ExtractedFields,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...parsed.options };

  // Assign positional arguments to their fields
  const positionalFields = extracted.fields.filter((f) => f.positional);

  // Combine positionals with rest args (after --) for assignment
  const allPositionals =
    parsed.rest.length > 0 ? [...parsed.positionals, ...parsed.rest] : parsed.positionals;

  let positionalIndex = 0;
  for (const field of positionalFields) {
    if (positionalIndex >= allPositionals.length) {
      break;
    }

    if (field.type === "array") {
      // Array positional consumes all remaining positionals (including rest args after --)
      result[field.name] = allPositionals.slice(positionalIndex);
      break; // No more positionals can follow (validated by validatePositionalConfig)
    } else {
      result[field.name] = allPositionals[positionalIndex]!;
      positionalIndex++;
    }
  }

  return result;
}
