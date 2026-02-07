import { styleText } from "node:util";

/**
 * Check if color output should be disabled
 */
function shouldDisableColor(): boolean {
  // Disable if NO_COLOR is set (https://no-color.org/)
  if (process.env.NO_COLOR !== undefined) {
    return true;
  }

  // Disable if FORCE_COLOR is explicitly set to 0
  if (process.env.FORCE_COLOR === "0") {
    return true;
  }

  // Enable if FORCE_COLOR is set (even in CI or non-TTY)
  if (process.env.FORCE_COLOR) {
    return false;
  }

  // Disable in CI environments
  if (process.env.CI) {
    return true;
  }

  // Disable if not a TTY
  if (!process.stdout.isTTY) {
    return true;
  }

  return false;
}

/**
 * Global flag to control color output
 */
let colorDisabled = shouldDisableColor();

/**
 * Enable or disable color output programmatically
 */
export function setColorEnabled(enabled: boolean): void {
  colorDisabled = !enabled;
}

/**
 * Check if color output is currently enabled
 */
export function isColorEnabled(): boolean {
  return !colorDisabled;
}

/**
 * Create a style function that applies the given styles
 */
function createStyleFn(...styleArgs: Parameters<typeof styleText>[0][]): (text: string) => string {
  return (text: string) => {
    if (colorDisabled) {
      return text;
    }
    let result = text;
    for (const style of styleArgs) {
      result = styleText(style, result);
    }
    return result;
  };
}

/**
 * Semantic style functions for inline text styling
 */
export const styles = {
  // Status colors
  success: createStyleFn("green"),
  error: createStyleFn("red"),
  warning: createStyleFn("yellow"),
  info: createStyleFn("cyan"),

  // Emphasis
  bold: createStyleFn("bold"),
  dim: createStyleFn("dim"),
  italic: createStyleFn("italic"),
  underline: createStyleFn("underline"),

  // Colors
  red: createStyleFn("red"),
  green: createStyleFn("green"),
  yellow: createStyleFn("yellow"),
  blue: createStyleFn("blue"),
  magenta: createStyleFn("magenta"),
  cyan: createStyleFn("cyan"),
  white: createStyleFn("white"),
  gray: createStyleFn("gray"),

  // Help-specific styles
  command: createStyleFn("bold"),
  commandName: createStyleFn("bold", "underline", "cyan"),
  option: createStyleFn("cyan"),
  optionName: createStyleFn("bold"),
  placeholder: createStyleFn("dim"),
  defaultValue: createStyleFn("dim"),
  required: createStyleFn("yellow"),
  description: (text: string) => text, // No style for descriptions
  sectionHeader: createStyleFn("bold", "underline"),
  version: createStyleFn("dim"),
};

/**
 * Standardized symbols for CLI output
 */
export const symbols = {
  success: styles.green("✓"),
  error: styles.red("✖"),
  warning: styles.yellow("⚠"),
  info: styles.cyan("ℹ"),
  bullet: styles.gray("•"),
  arrow: styles.gray("→"),
};

/**
 * Logger for CLI output
 */
export const logger = {
  /**
   * Log informational message
   */
  info(message: string): void {
    console.log(message);
  },

  /**
   * Log success message
   */
  success(message: string): void {
    console.log(`${symbols.success} ${styles.success(message)}`);
  },

  /**
   * Log warning message
   */
  warn(message: string): void {
    console.warn(`${symbols.warning} ${styles.warning(message)}`);
  },

  /**
   * Log error message
   */
  error(message: string): void {
    console.error(`${symbols.error} ${styles.error(message)}`);
  },

  /**
   * Log raw message without prefix
   */
  log(message: string): void {
    console.log(message);
  },

  /**
   * Log empty line
   */
  newline(): void {
    console.log("");
  },

  /**
   * Log debug message with dim color
   */
  debug(message: string): void {
    console.log(styles.dim(message));
  },
};
