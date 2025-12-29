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
