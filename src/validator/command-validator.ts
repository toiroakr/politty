import {
  extractFields,
  getAllAliases,
  toCamelCase,
  type ExtractedFields,
  type ResolvedFieldMeta,
} from "../core/schema-extractor.js";
import { resolveLazyCommand } from "../executor/subcommand-router.js";
import { isLazyCommand } from "../lazy.js";
import type { AnyCommand, ArgsSchema } from "../types.js";
import {
  CaseVariantCollisionError,
  DuplicateAliasError,
  DuplicateFieldError,
  DuplicateNegationError,
  FieldTypeConflictError,
  PositionalConfigError,
  ReservedAliasError,
  ReservedFieldNameError,
} from "./validation-errors.js";

// Re-export error classes for convenience
export {
  CaseVariantCollisionError,
  DuplicateAliasError,
  DuplicateFieldError,
  DuplicateNegationError,
  FieldTypeConflictError,
  PositionalConfigError,
  ReservedAliasError,
  ReservedFieldNameError,
};

/**
 * Error detail for command validation
 */
export interface CommandValidationError {
  /** Path to the command (e.g., ["cli", "build", "watch"]) */
  commandPath: string[];
  /** Error type */
  type:
    | "duplicate_field"
    | "duplicate_alias"
    | "invalid_alias"
    | "positional_config"
    | "reserved_alias"
    | "reserved_field_name"
    | "case_variant_collision"
    | "duplicate_negation"
    | "field_type_conflict";
  /** Error message */
  message: string;
  /** Related field name (if applicable) */
  field?: string;
}

/**
 * Result of command validation
 */
export type CommandValidationResult =
  | { valid: true }
  | { valid: false; errors: CommandValidationError[] };

/**
 * Options for validateCommand
 */
export interface ValidateCommandOptions {
  /** Starting command path (for nested validation) */
  commandPath?: string[];
  /**
   * Global args schema to check the command tree against for cross-schema
   * field collisions (case-variant collisions and `FieldTypeConflictError`
   * conflicts) -- the same check `runCommand()` performs per-invocation at
   * parse time, but here applied eagerly to every command and subcommand
   * regardless of which subcommand path actually gets invoked at runtime.
   */
  globalArgs?: ArgsSchema;
}

// ============================================================================
// Private check functions (single source of truth for validation logic)
// ============================================================================

/**
 * Check for duplicate field names
 */
function checkDuplicateFields(
  extracted: ExtractedFields,
  commandPath: string[],
): CommandValidationError[] {
  const errors: CommandValidationError[] = [];
  const seenNames = new Map<string, string>();

  for (const field of extracted.fields) {
    if (seenNames.has(field.name)) {
      errors.push({
        commandPath,
        type: "duplicate_field",
        message: `Duplicate field name "${field.name}" detected.`,
        field: field.name,
      });
    }
    seenNames.set(field.name, field.name);
  }
  return errors;
}

/**
 * Check for case-variant collisions (e.g. "my-option" and "myOption" defined simultaneously)
 */
function checkCaseVariantCollisions(
  extracted: ExtractedFields,
  commandPath: string[],
): CommandValidationError[] {
  const errors: CommandValidationError[] = [];
  const canonicalMap = new Map<string, string>();

  for (const field of extracted.fields) {
    const camel = toCamelCase(field.name);
    const existing = canonicalMap.get(camel);
    if (existing && existing !== field.name) {
      errors.push({
        commandPath,
        type: "case_variant_collision",
        message: `Fields "${existing}" and "${field.name}" are case variants of each other and would collide.`,
        field: field.name,
      });
    }
    canonicalMap.set(camel, field.name);
  }
  return errors;
}

/**
 * Check for duplicate aliases and alias-field name conflicts
 */
function checkDuplicateAliases(
  extracted: ExtractedFields,
  commandPath: string[],
): CommandValidationError[] {
  const errors: CommandValidationError[] = [];
  const seenAliases = new Map<string, string>();
  const fieldNames = new Set(extracted.fields.map((f) => f.name));
  const cliNames = new Set(extracted.fields.map((f) => f.cliName));

  // Helper: register an alias (or derived variant) and check for conflicts
  const registerAlias = (alias: string, fieldName: string, isDerived: boolean) => {
    // Check if alias conflicts with an existing field name / cliName
    if (fieldNames.has(alias) || cliNames.has(alias)) {
      errors.push({
        commandPath,
        type: "duplicate_alias",
        message: `Alias "${alias}" for field "${fieldName}" conflicts with existing field name or CLI name "${alias}".`,
        field: fieldName,
      });
    }

    // Check if alias is already used by another field
    const existingField = seenAliases.get(alias);
    if (existingField && existingField !== fieldName) {
      const qualifier = isDerived ? " (derived camelCase variant)" : "";
      errors.push({
        commandPath,
        type: "duplicate_alias",
        message: `Duplicate alias "${alias}"${qualifier} detected. Both "${existingField}" and "${fieldName}" use the same alias.`,
        field: fieldName,
      });
    }
    seenAliases.set(alias, fieldName);
  };

  for (const field of extracted.fields) {
    const allAliases = getAllAliases(field);
    if (allAliases.length === 0) continue;

    for (const alias of allAliases) {
      registerAlias(alias, field.name, false);

      // Also validate implicit camelCase variants of hyphenated long aliases,
      // since the parser registers these as additional lookup entries.
      if (alias.length > 1 && alias.includes("-")) {
        const camelVariant = toCamelCase(alias);
        if (camelVariant !== alias && !fieldNames.has(camelVariant)) {
          registerAlias(camelVariant, field.name, true);
        }
      }
    }
  }
  return errors;
}

/**
 * Check for collisions involving custom boolean `negation` names
 */
function checkDuplicateNegations(
  extracted: ExtractedFields,
  commandPath: string[],
): CommandValidationError[] {
  const errors: CommandValidationError[] = [];

  type ClaimKind = "field name" | "CLI name" | "alias" | "default negation";
  const claimed = new Map<string, { field: string; kind: ClaimKind }>();
  const claim = (name: string, fieldName: string, kind: ClaimKind) => {
    if (!claimed.has(name)) claimed.set(name, { field: fieldName, kind });
  };
  for (const field of extracted.fields) {
    claim(field.name, field.name, "field name");
    if (field.name.includes("-")) {
      // The argv parser also accepts the camelCase form of a kebab-case field
      // key (e.g. `--dryRun` for `"dry-run"`). Reserve that variant so a custom
      // negation cannot shadow another field's implicit positive flag.
      const camelName = toCamelCase(field.name);
      if (camelName !== field.name) claim(camelName, field.name, "field name");
    }
    if (field.cliName !== field.name) {
      claim(field.cliName, field.name, "CLI name");
    }
    if (field.cliName.includes("-")) {
      const camelCli = toCamelCase(field.cliName);
      if (camelCli !== field.cliName) claim(camelCli, field.name, "CLI name");
    }
    for (const alias of getAllAliases(field)) {
      claim(alias, field.name, "alias");
      if (alias.length > 1 && alias.includes("-")) {
        const camelVariant = toCamelCase(alias);
        if (camelVariant !== alias) {
          claim(camelVariant, field.name, "alias");
        }
      }
    }

    // Reserve opt-in default negation tokens so a custom `negation: "no-X"`
    // cannot silently shadow another field's default `--no-X`. Uses the
    // first-wins `claim()` helper so an earlier, higher-priority field/cliName
    // claim isn't replaced by a default negation slot.
    if (field.type === "boolean" && field.negation === true) {
      const defaultKebab = `no-${field.cliName}`;
      claim(defaultKebab, field.name, "default negation");
      // Derive the camelCase form from cliName via toCamelCase so kebab-case
      // field keys (e.g. `"dry-run"`) reserve `noDryRun`, matching the form
      // the argv parser actually recognizes — not literal `noDry-run`.
      const camelBase = toCamelCase(field.cliName);
      const defaultCamel = `no${camelBase[0]?.toUpperCase() ?? ""}${camelBase.slice(1)}`;
      if (defaultCamel !== defaultKebab) {
        claim(defaultCamel, field.name, "default negation");
      }
    }
  }

  const seenNegations = new Map<string, string>();

  const register = (name: string, fieldName: string, isDerived: boolean) => {
    const claim = claimed.get(name);
    if (claim) {
      const qualifier = isDerived ? " (derived camelCase variant)" : "";
      const conflict =
        claim.field === fieldName
          ? `the same field's own ${claim.kind} "${name}"`
          : `${claim.kind} "${name}" of field "${claim.field}"`;
      errors.push({
        commandPath,
        type: "duplicate_negation",
        message: `Negation "${name}"${qualifier} for field "${fieldName}" conflicts with ${conflict}.`,
        field: fieldName,
      });
    }

    const existing = seenNegations.get(name);
    if (existing && existing !== fieldName) {
      const qualifier = isDerived ? " (derived camelCase variant)" : "";
      errors.push({
        commandPath,
        type: "duplicate_negation",
        message: `Duplicate negation "${name}"${qualifier} detected. Both "${existing}" and "${fieldName}" use the same negation name.`,
        field: fieldName,
      });
    }
    seenNegations.set(name, fieldName);
  };

  for (const field of extracted.fields) {
    if (typeof field.negation !== "string") continue;
    register(field.negation, field.name, false);
    if (field.negation.includes("-")) {
      const camelVariant = toCamelCase(field.negation);
      if (camelVariant !== field.negation) {
        register(camelVariant, field.name, true);
      }
    }
  }

  return errors;
}

/**
 * Check positional argument configuration
 */
function checkPositionalConfig(
  extracted: ExtractedFields,
  commandPath: string[],
): CommandValidationError[] {
  const errors: CommandValidationError[] = [];
  const positionalFields = extracted.fields.filter((f) => f.positional);

  let foundArrayPositional: string | null = null;
  let foundOptionalPositional: string | null = null;

  for (const field of positionalFields) {
    // Check: no positional can follow array positional
    if (foundArrayPositional !== null) {
      errors.push({
        commandPath,
        type: "positional_config",
        message: `Positional argument "${field.name}" cannot follow array positional argument "${foundArrayPositional}".`,
        field: field.name,
      });
    }

    // Check: array positional cannot coexist with optional positional
    if (field.type === "array" && foundOptionalPositional !== null) {
      errors.push({
        commandPath,
        type: "positional_config",
        message: `Array positional "${field.name}" cannot be used with optional positional "${foundOptionalPositional}" (ambiguous parsing).`,
        field: field.name,
      });
    }

    // Check: required positional cannot follow optional positional
    if (foundOptionalPositional !== null && field.required) {
      errors.push({
        commandPath,
        type: "positional_config",
        message: `Required positional "${field.name}" cannot follow optional positional "${foundOptionalPositional}".`,
        field: field.name,
      });
    }

    if (field.type === "array") {
      foundArrayPositional = field.name;
    }
    if (!field.required) {
      foundOptionalPositional = field.name;
    }
  }
  return errors;
}

/**
 * Check for reserved aliases used without override flag
 */
function checkReservedAliases(
  extracted: ExtractedFields,
  commandPath: string[],
): CommandValidationError[] {
  const errors: CommandValidationError[] = [];

  for (const field of extracted.fields) {
    if (field.overrideBuiltinAlias === true) continue;
    for (const alias of getAllAliases(field)) {
      if (alias === "h" || alias === "H") {
        errors.push({
          commandPath,
          type: "reserved_alias",
          message: `Alias "${alias}" is reserved for --${alias === "h" ? "help" : "help-all"}.`,
          field: field.name,
        });
      }
    }
  }
  return errors;
}

/**
 * Check for field names starting with `$`.
 *
 * The `$` prefix is reserved for framework-injected helpers on the final
 * args object (e.g. `$source`). It is also impractical as a real CLI flag
 * since an unquoted `$name` is expanded by the shell before it ever reaches
 * the program, so this is rejected outright rather than merely discouraged.
 *
 * Aliases can't start with `$` (schema extraction already restricts alias
 * characters to `[A-Za-z0-9-]`), and `cliName` is derived from `name` via
 * `toKebabCase`, which never strips or moves a leading `$` — so checking
 * `field.name` alone covers every way `$` could reach the final args object.
 */
function checkReservedFieldNames(
  extracted: ExtractedFields,
  commandPath: string[],
): CommandValidationError[] {
  const errors: CommandValidationError[] = [];

  for (const field of extracted.fields) {
    if (field.name.startsWith("$")) {
      errors.push({
        commandPath,
        type: "reserved_field_name",
        message: `Field "${field.name}" starts with "$", which is reserved for framework-injected helpers (e.g. $source).`,
        field: field.name,
      });
    }
  }
  return errors;
}

// ============================================================================
// Public throwing validators (for runtime validation)
// ============================================================================

/**
 * Validate that no duplicate field names exist
 *
 * @param extracted - Extracted fields from schema
 * @throws {DuplicateFieldError} If duplicate field names are found
 */
export function validateDuplicateFields(extracted: ExtractedFields): void {
  const errors = checkDuplicateFields(extracted, []);
  if (errors.length > 0) {
    const field = errors[0]?.field ?? "unknown";
    throw new DuplicateFieldError(
      `Duplicate field name "${field}" detected. Each field must have a unique name.`,
    );
  }
}

/**
 * Validate that no duplicate aliases exist
 *
 * Also checks for conflicts between aliases and field names
 *
 * @param extracted - Extracted fields from schema
 * @throws {DuplicateAliasError} If duplicate aliases are found or alias conflicts with field name
 */
export function validateDuplicateAliases(extracted: ExtractedFields): void {
  const errors = checkDuplicateAliases(extracted, []);
  if (errors.length > 0) {
    const err = errors[0]!;
    throw new DuplicateAliasError(err.message);
  }
}

/**
 * Validate positional argument configuration
 *
 * Rules:
 * - Array positional arguments must be the last positional
 * - No positional arguments can follow an array positional
 * - Required positional arguments cannot follow optional positional arguments
 * - Array positional and optional positional cannot be used together (ambiguous parsing)
 *
 * @param extracted - Extracted fields from schema
 * @throws {PositionalConfigError} If configuration is invalid
 */
export function validatePositionalConfig(extracted: ExtractedFields): void {
  const errors = checkPositionalConfig(extracted, []);
  if (errors.length > 0) {
    const err = errors[0]!;
    throw new PositionalConfigError(err.message);
  }
}

/**
 * Validate that no reserved aliases are used without explicit override
 *
 * Reserved aliases:
 * - 'h' is reserved for --help
 * - 'H' is reserved for --help-all
 *
 * Users can override these by setting overrideBuiltinAlias: true
 *
 * @param extracted - Extracted fields from schema
 * @param _hasSubCommands - Whether the command has subcommands (reserved for future use)
 * @throws {ReservedAliasError} If a reserved alias is used without override flag
 */
export function validateReservedAliases(
  extracted: ExtractedFields,
  _hasSubCommands: boolean,
): void {
  const errors = checkReservedAliases(extracted, []);
  if (errors.length > 0) {
    const err = errors[0]!;
    const field = err.field ?? "unknown";
    const found = extracted.fields.find((f) => f.name === field);
    const aliasList = found ? getAllAliases(found) : [];
    const alias = aliasList.find((a) => a === "h" || a === "H") ?? "h";
    throw new ReservedAliasError(
      `Alias "${alias}" is reserved for --${alias === "h" ? "help" : "help-all"}. ` +
        `To override this, set { overrideBuiltinAlias: true } for "${field}" ` +
        `and keep the alias where it is currently defined (in alias or hiddenAlias).`,
    );
  }
}

/**
 * Validate that no field name starts with `$`
 *
 * The `$` prefix is reserved for framework-injected helpers on the final
 * args object (e.g. `$source`), and is unusable as a real CLI flag anyway
 * since an unquoted `$name` gets shell-expanded before the program sees it.
 *
 * Checking `field.name` alone is sufficient: aliases can't start with `$`
 * (schema extraction already restricts alias characters to `[A-Za-z0-9-]`),
 * and `cliName` is derived from `name` via `toKebabCase`, which never strips
 * or moves a leading `$`. See {@link checkReservedFieldNames}.
 *
 * @param extracted - Extracted fields from schema
 * @throws {ReservedFieldNameError} If a field name starts with "$"
 */
export function validateReservedFieldNames(extracted: ExtractedFields): void {
  const errors = checkReservedFieldNames(extracted, []);
  if (errors.length > 0) {
    const err = errors[0]!;
    throw new ReservedFieldNameError(err.message);
  }
}

/**
 * Validate that custom boolean negation names do not collide with anything
 *
 * @param extracted - Extracted fields from schema
 * @throws {DuplicateNegationError} If a colliding negation is found
 */
export function validateDuplicateNegations(extracted: ExtractedFields): void {
  const errors = checkDuplicateNegations(extracted, []);
  if (errors.length > 0) {
    const err = errors[0]!;
    throw new DuplicateNegationError(err.message);
  }
}

/**
 * Validate that no case-variant collisions exist
 *
 * @param extracted - Extracted fields from schema
 * @throws {CaseVariantCollisionError} If case-variant collisions are found
 */
export function validateCaseVariantCollisions(extracted: ExtractedFields): void {
  const errors = checkCaseVariantCollisions(extracted, []);
  if (errors.length > 0) {
    const err = errors[0]!;
    throw new CaseVariantCollisionError(err.message);
  }
}

/**
 * Check whether two same-named fields from different schemas (e.g. global
 * args and command args) have identical definitions. Only the facts
 * `extractFields()` already exposes are compared: the coarse type bucket,
 * whether the field is positional, and, for enum-like fields, the exact
 * set of allowed values. Anything `extractFields()` can't see (e.g. a
 * `.refine()`) is intentionally not compared — this is a coarse, cheap
 * equality check, not a full schema comparison.
 */
function fieldsAreIdentical(a: ResolvedFieldMeta, b: ResolvedFieldMeta): boolean {
  if (a.type !== b.type) return false;
  if (a.positional !== b.positional) return false;
  const aEnum = a.enumValues;
  const bEnum = b.enumValues;
  if (!aEnum && !bEnum) return true;
  if (!aEnum || !bEnum) return false;
  // Compare as sets, not arrays: extractEnumValues() can return duplicate
  // entries for literal-union-style enums, which would otherwise make two
  // schemas with an identical *set* of allowed values compare unequal.
  const aSet = new Set(aEnum);
  const bSet = new Set(bEnum);
  if (aSet.size !== bSet.size) return false;
  for (const value of aSet) {
    if (!bSet.has(value)) return false;
  }
  return true;
}

/**
 * Check for cross-schema collisions between two schemas (e.g., global args
 * and command args): neither a case-variant collision (same canonical name,
 * different spelling) nor a same-named field with a different definition
 * (same spelling, but the two schemas don't agree on what values are valid).
 */
function checkCrossSchemaCollisions(
  extractedA: ExtractedFields,
  extractedB: ExtractedFields,
  commandPath: string[],
): CommandValidationError[] {
  const errors: CommandValidationError[] = [];
  const canonicalMap = new Map<string, ResolvedFieldMeta>();

  for (const field of extractedA.fields) {
    canonicalMap.set(toCamelCase(field.name), field);
  }

  for (const field of extractedB.fields) {
    const camel = toCamelCase(field.name);
    const existing = canonicalMap.get(camel);
    if (!existing) continue;
    if (existing.name !== field.name) {
      errors.push({
        commandPath,
        type: "case_variant_collision",
        message: `Global field "${existing.name}" and command field "${field.name}" are case variants of each other and would collide.`,
        field: field.name,
      });
      continue;
    }
    if (!fieldsAreIdentical(existing, field)) {
      errors.push({
        commandPath,
        type: "field_type_conflict",
        message: `Global field "${existing.name}" and command field "${field.name}" share the same name but have different definitions.`,
        field: field.name,
      });
    }
  }
  return errors;
}

/**
 * Validate that no cross-schema collisions exist between two schemas
 * (e.g., global args and command args): neither a case-variant collision
 * (same canonical name, different spelling) nor a same-named field with a
 * different definition (same spelling, but the two schemas don't agree on
 * what values are valid).
 *
 * @param extractedA - Extracted fields from first schema (e.g., global args)
 * @param extractedB - Extracted fields from second schema (e.g., command args)
 * @throws {CaseVariantCollisionError} If cross-schema case-variant collisions are found
 * @throws {FieldTypeConflictError} If a same-named field has a different definition on each schema
 */
export function validateCrossSchemaCollisions(
  extractedA: ExtractedFields,
  extractedB: ExtractedFields,
): void {
  const errors = checkCrossSchemaCollisions(extractedA, extractedB, []);
  const err = errors[0];
  if (!err) return;
  if (err.type === "case_variant_collision") {
    throw new CaseVariantCollisionError(err.message);
  }
  throw new FieldTypeConflictError(err.message);
}

// ============================================================================
// Non-throwing validators (for collecting all errors)
// ============================================================================

/**
 * Collect validation errors for a single command's schema (non-throwing)
 */
function collectSchemaErrors(
  extracted: ExtractedFields,
  _hasSubCommands: boolean,
  commandPath: string[],
): CommandValidationError[] {
  return [
    ...checkDuplicateFields(extracted, commandPath),
    ...checkCaseVariantCollisions(extracted, commandPath),
    ...checkDuplicateAliases(extracted, commandPath),
    ...checkDuplicateNegations(extracted, commandPath),
    ...checkPositionalConfig(extracted, commandPath),
    ...checkReservedAliases(extracted, commandPath),
    ...checkReservedFieldNames(extracted, commandPath),
  ];
}

/**
 * Check for alias conflicts within subcommands
 * - Aliases must not conflict with subcommand names
 * - Aliases must not conflict with other aliases
 */
function checkSubCommandAliasConflicts(
  command: AnyCommand,
  commandPath: string[],
): CommandValidationError[] {
  const errors: CommandValidationError[] = [];
  if (!command.subCommands) return errors;

  // Build a map of all registered names (subcommand names + aliases)
  const nameToOwner = new Map<string, string>();
  for (const [name] of Object.entries(command.subCommands)) {
    nameToOwner.set(name, name);
  }

  for (const [name, subCmdValue] of Object.entries(command.subCommands)) {
    const resolved = isLazyCommand(subCmdValue)
      ? subCmdValue.meta
      : typeof subCmdValue !== "function"
        ? (subCmdValue as AnyCommand)
        : null;
    if (!resolved?.aliases) continue;

    const subCommandPath = [...commandPath, name];
    for (const alias of resolved.aliases) {
      // Validate alias format: must be a safe token (alphanumeric, hyphens, underscores).
      // Rejects empty strings, leading dashes, whitespace, colons (used as path
      // separator in completion scripts), and shell metacharacters ($, `, ", ', \).
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(alias)) {
        errors.push({
          commandPath: subCommandPath,
          type: "invalid_alias",
          message: `Alias "${alias}" is invalid. Aliases must start with an alphanumeric character and contain only alphanumeric characters, hyphens, or underscores.`,
          field: name,
        });
        continue;
      }

      // Check if alias equals its own canonical name
      if (alias === name) {
        errors.push({
          commandPath: subCommandPath,
          type: "duplicate_alias",
          message: `Alias "${alias}" conflicts with its own name.`,
          field: name,
        });
        continue;
      }

      const existing = nameToOwner.get(alias);
      if (existing) {
        if (existing === name) {
          errors.push({
            commandPath: subCommandPath,
            type: "duplicate_alias",
            message: `Alias "${alias}" is duplicated within the alias list.`,
            field: name,
          });
        } else {
          errors.push({
            commandPath: subCommandPath,
            type: "duplicate_alias",
            message: `Alias "${alias}" conflicts with existing subcommand or alias "${existing}".`,
            field: name,
          });
        }
      } else {
        nameToOwner.set(alias, name);
      }
    }
  }

  return errors;
}

/**
 * Validate a command and all its subcommands recursively
 *
 * This function collects all validation errors without throwing,
 * making it suitable for test assertions.
 *
 * @param command - The command to validate
 * @param options - Validation options
 * @returns Validation result with all errors collected
 *
 * @example
 * ```ts
 * const result = await validateCommand(myCommand);
 * if (!result.valid) {
 *   console.error(result.errors);
 * }
 * ```
 */
export async function validateCommand(
  command: AnyCommand,
  options: ValidateCommandOptions = {},
): Promise<CommandValidationResult> {
  const commandPath = options.commandPath ?? [command.name];
  const errors: CommandValidationError[] = [];
  const hasSubCommands = command.subCommands ? Object.keys(command.subCommands).length > 0 : false;
  const globalExtracted = options.globalArgs ? extractFields(options.globalArgs) : undefined;

  // Validate current command's schema
  if (command.args) {
    const extracted = extractFields(command.args);
    errors.push(...collectSchemaErrors(extracted, hasSubCommands, commandPath));
    if (globalExtracted) {
      errors.push(...checkCrossSchemaCollisions(globalExtracted, extracted, commandPath));
    }
  }

  // Validate subcommand alias conflicts
  errors.push(...checkSubCommandAliasConflicts(command, commandPath));

  // Recursively validate subcommands
  if (command.subCommands) {
    for (const [name, subCmd] of Object.entries(command.subCommands)) {
      const resolvedSubCmd = await resolveLazyCommand(subCmd);
      const subResult = await validateCommand(resolvedSubCmd, {
        commandPath: [...commandPath, name],
        ...(options.globalArgs ? { globalArgs: options.globalArgs } : {}),
      });
      if (!subResult.valid) {
        errors.push(...subResult.errors);
      }
    }
  }

  if (errors.length === 0) {
    return { valid: true };
  }

  return { valid: false, errors };
}

/**
 * Format command validation errors for display
 *
 * @param errors - Array of validation errors
 * @returns Formatted error message
 */
export function formatCommandValidationErrors(errors: CommandValidationError[]): string {
  if (errors.length === 0) return "";

  const lines: string[] = ["Command definition errors:"];
  for (const error of errors) {
    const path = error.commandPath.join(" > ");
    lines.push(`  - [${path}] ${error.message}`);
  }
  return lines.join("\n");
}
