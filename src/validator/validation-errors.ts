/**
 * Error thrown when positional argument configuration is invalid
 */
export class PositionalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionalConfigError";
  }
}

/**
 * Error thrown when a reserved alias is used
 */
export class ReservedAliasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservedAliasError";
  }
}

/**
 * Error thrown when duplicate field names are detected
 */
export class DuplicateFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateFieldError";
  }
}

/**
 * Error thrown when duplicate aliases are detected
 */
export class DuplicateAliasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateAliasError";
  }
}

/**
 * Error thrown when fields are case variants of each other (e.g. "my-option" and "myOption")
 */
export class CaseVariantCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseVariantCollisionError";
  }
}

/**
 * Error thrown when a custom boolean negation name collides with another
 * field's name, cliName, alias, or another field's negation (including
 * derived camelCase variants).
 */
export class DuplicateNegationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateNegationError";
  }
}

/**
 * Error thrown when a field name collides with a reserved, framework-injected
 * key on the final args object (e.g. `$source`).
 */
export class ReservedFieldNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservedFieldNameError";
  }
}

/**
 * Error thrown when a global field and a same-named local field have
 * different definitions (per `extractFields()`'s type bucket and enum
 * values). Only exactly-matching definitions are allowed to share a name
 * across global/local schemas — anything else is rejected at validation
 * time rather than risking a value from one schema silently flowing into
 * the other.
 */
export class FieldTypeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldTypeConflictError";
  }
}
