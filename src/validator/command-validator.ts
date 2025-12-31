import { extractFields, type ExtractedFields } from "../core/schema-extractor.js";
import { resolveLazyCommand } from "../executor/subcommand-router.js";
import type { AnyCommand } from "../types.js";
import {
    DuplicateAliasError,
    DuplicateFieldError,
    PositionalConfigError,
    ReservedAliasError
} from "./validation-errors.js";

// Re-export error classes for convenience
export { DuplicateAliasError, DuplicateFieldError, PositionalConfigError, ReservedAliasError };

/**
 * Error detail for command validation
 */
export interface CommandValidationError {
  /** Path to the command (e.g., ["cli", "build", "watch"]) */
  commandPath: string[];
  /** Error type */
  type: "duplicate_field" | "duplicate_alias" | "positional_config" | "reserved_alias";
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
 * Check for duplicate aliases and alias-field name conflicts
 */
function checkDuplicateAliases(
  extracted: ExtractedFields,
  commandPath: string[],
): CommandValidationError[] {
  const errors: CommandValidationError[] = [];
  const seenAliases = new Map<string, string>();
  const fieldNames = new Set(extracted.fields.map((f) => f.name));

  for (const field of extracted.fields) {
    if (!field.alias) continue;

    // Check if alias conflicts with an existing field name
    if (fieldNames.has(field.alias)) {
      errors.push({
        commandPath,
        type: "duplicate_alias",
        message: `Alias "${field.alias}" for field "${field.name}" conflicts with existing field name "${field.alias}".`,
        field: field.name,
      });
    }

    // Check if alias is already used by another field
    const existingField = seenAliases.get(field.alias);
    if (existingField) {
      errors.push({
        commandPath,
        type: "duplicate_alias",
        message: `Duplicate alias "${field.alias}" detected. Both "${existingField}" and "${field.name}" use the same alias.`,
        field: field.name,
      });
    }
    seenAliases.set(field.alias, field.name);
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
    if ((field.alias === "h" || field.alias === "H") && field.overrideBuiltinAlias !== true) {
      errors.push({
        commandPath,
        type: "reserved_alias",
        message: `Alias "${field.alias}" is reserved for --${field.alias === "h" ? "help" : "help-all"}.`,
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
    const alias = extracted.fields.find((f) => f.name === field)?.alias ?? "h";
    throw new ReservedAliasError(
      `Alias "${alias}" is reserved for --${alias === "h" ? "help" : "help-all"}. ` +
        `To override this, set { alias: "${alias}", overrideBuiltinAlias: true } for "${field}".`,
    );
  }
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
    ...checkDuplicateAliases(extracted, commandPath),
    ...checkPositionalConfig(extracted, commandPath),
    ...checkReservedAliases(extracted, commandPath),
  ];
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

  // Validate current command's schema
  if (command.args) {
    const extracted = extractFields(command.args);
    errors.push(...collectSchemaErrors(extracted, hasSubCommands, commandPath));
  }

  // Recursively validate subcommands
  if (command.subCommands) {
    for (const [name, subCmd] of Object.entries(command.subCommands)) {
      const resolvedSubCmd = await resolveLazyCommand(subCmd);
      const subResult = await validateCommand(resolvedSubCmd, {
        commandPath: [...commandPath, name],
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
