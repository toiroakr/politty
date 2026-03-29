/**
 * Detect whether the current environment supports interactive prompts.
 * Returns false in CI, piped input, or non-TTY environments.
 */
export function isInteractive(): boolean {
  if (!process.stdin.isTTY) return false;
  if (!process.stdout.isTTY) return false;
  if (process.env.CI) return false;
  if (process.env.POLITTY_NO_PROMPT) return false;
  return true;
}
