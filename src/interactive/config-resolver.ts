import type {
  AnyCommand,
  InteractiveConfig,
  InteractiveMode,
  InteractiveOption,
} from "../types.js";

/**
 * Normalize interactive option to InteractiveConfig
 */
export function normalizeInteractiveConfig(
  interactive: InteractiveOption | undefined,
): InteractiveConfig {
  if (!interactive) {
    return { mode: false };
  }
  if (typeof interactive === "object") {
    return interactive;
  }
  return { mode: interactive };
}

/**
 * Resolve interactive configuration, merging with inherited config
 *
 * Priority:
 * 1. Command's interactive setting (highest)
 * 2. Inherited config from runMain (default)
 * 3. false (disabled)
 */
export function resolveInteractiveConfig(
  command: AnyCommand,
  inheritedConfig?: InteractiveConfig | undefined,
): InteractiveConfig {
  // Normalize command's interactive setting
  const commandConfig = normalizeInteractiveConfig(command.interactive);

  // If command has explicit setting, use it
  // (including explicit false to disable inherited config)
  if (command.interactive !== undefined) {
    // Use command's mode, but inherit prompts if not specified
    const prompts = commandConfig.prompts ?? inheritedConfig?.prompts;
    return prompts !== undefined
      ? { mode: commandConfig.mode, prompts }
      : { mode: commandConfig.mode };
  }

  // If command doesn't have explicit setting, inherit from parent
  if (inheritedConfig && inheritedConfig.mode !== false) {
    return inheritedConfig;
  }

  // Default: disabled
  return { mode: false };
}

/**
 * Check if interactive mode should be skipped
 * (non-TTY environment or CI environment)
 */
export function shouldSkipInteractive(): boolean {
  // Check for CI environment
  if (process.env.CI === "true" || process.env.POLITTY_NON_INTERACTIVE === "true") {
    return true;
  }

  // Check for TTY
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return true;
  }

  return false;
}

/**
 * Get the effective interactive mode considering environment
 */
export function getEffectiveMode(config: InteractiveConfig): InteractiveMode {
  if (shouldSkipInteractive()) {
    return false;
  }
  return config.mode;
}
