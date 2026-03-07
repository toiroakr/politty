import type { ExtractedFields } from "../core/schema-extractor.js";
import { buildParserOptions } from "./argv-parser.js";

/**
 * Result of scanning argv for subcommand position
 */
export interface ScanResult {
  /** Index of the subcommand in argv (-1 if not found) */
  subCommandIndex: number;
  /** Global arg tokens found before the subcommand */
  globalTokensBefore: string[];
  /** All tokens after the subcommand (including the subcommand itself is excluded) */
  tokensAfterSubcommand: string[];
}

/**
 * Scan argv to find the subcommand position, skipping over global flags.
 *
 * Walks argv and recognizes global flags (long, short, --no-*) so that
 * `my-cli --verbose build --output dist` correctly identifies `build` as
 * the subcommand (index 1) rather than treating `--verbose` as the subcommand.
 *
 * Limitation: flags appearing before the subcommand name are matched only
 * against the global schema. If a flag is defined in both global and a
 * subcommand's local schema, the pre-subcommand occurrence is always treated
 * as global because the local schema is not available until the subcommand is
 * identified (lazy-loaded commands make eager checking infeasible). Place
 * colliding flags after the subcommand name so that `separateGlobalArgs` can
 * apply local-precedence logic.
 *
 * @param argv - Command line arguments
 * @param subCommandNames - Valid subcommand names
 * @param globalExtracted - Extracted fields from global args schema
 * @returns Scan result with subcommand position and token separation
 */
export function scanForSubcommand(
  argv: string[],
  subCommandNames: string[],
  globalExtracted: ExtractedFields,
): ScanResult {
  const parserOptions = buildParserOptions(globalExtracted);
  const { aliasMap = new Map(), booleanFlags = new Set() } = parserOptions;

  // Build a set of known global flag names (resolved to camelCase)
  const knownGlobalFlags = new Set(globalExtracted.fields.map((f) => f.name));
  const knownGlobalCliNames = new Set(globalExtracted.fields.map((f) => f.cliName));
  const knownGlobalAliases = new Set(
    globalExtracted.fields.filter((f) => f.alias).map((f) => f.alias!),
  );

  const subCommandNameSet = new Set(subCommandNames);
  const globalTokensBefore: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    // Stop scanning on --
    if (arg === "--") {
      break;
    }

    // Stop scanning on --help, -h, --help-all, -H, --version (builtin flags)
    if (
      arg === "--help" ||
      arg === "-h" ||
      arg === "--help-all" ||
      arg === "-H" ||
      arg === "--version"
    ) {
      break;
    }

    // Check for subcommand (non-flag argument that matches a subcommand name)
    if (!arg.startsWith("-") && subCommandNameSet.has(arg)) {
      return {
        subCommandIndex: i,
        globalTokensBefore,
        tokensAfterSubcommand: argv.slice(i + 1),
      };
    }

    // Long option: --flag or --flag=value or --no-flag
    if (arg.startsWith("--")) {
      const withoutDashes = arg.includes("=") ? arg.slice(2, arg.indexOf("=")) : arg.slice(2);

      // Handle --no-flag
      const flagName = withoutDashes.startsWith("no-") ? withoutDashes.slice(3) : withoutDashes;
      const resolvedName = aliasMap.get(flagName) ?? flagName;
      const isKnownGlobal =
        knownGlobalFlags.has(resolvedName) ||
        knownGlobalCliNames.has(withoutDashes) ||
        knownGlobalCliNames.has(flagName);

      if (isKnownGlobal) {
        globalTokensBefore.push(arg);
        // If not boolean and no = sign, consume next arg as value
        if (
          !arg.includes("=") &&
          !booleanFlags.has(resolvedName) &&
          !withoutDashes.startsWith("no-")
        ) {
          const nextArg = argv[i + 1];
          if (nextArg !== undefined && !nextArg.startsWith("-")) {
            globalTokensBefore.push(nextArg);
            i += 2;
            continue;
          }
        }
        i++;
        continue;
      }

      // Unknown long flag - not a global flag, skip
      break;
    }

    // Short option: -f or -f=value
    if (arg.startsWith("-") && arg.length > 1) {
      const withoutDash = arg.includes("=") ? arg.slice(1, arg.indexOf("=")) : arg.slice(1);

      // Single char short option
      if (withoutDash.length === 1) {
        const resolvedName = aliasMap.get(withoutDash) ?? withoutDash;
        const isKnownGlobal =
          knownGlobalAliases.has(withoutDash) || knownGlobalFlags.has(resolvedName);

        if (isKnownGlobal) {
          globalTokensBefore.push(arg);
          // If not boolean and no = sign, consume next arg as value
          if (!arg.includes("=") && !booleanFlags.has(resolvedName)) {
            const nextArg = argv[i + 1];
            if (nextArg !== undefined && !nextArg.startsWith("-")) {
              globalTokensBefore.push(nextArg);
              i += 2;
              continue;
            }
          }
          i++;
          continue;
        }
      }

      // Unknown short flag or combined flags - stop scanning
      break;
    }

    // Non-flag, non-subcommand positional - stop scanning
    break;
  }

  // No subcommand found
  return {
    subCommandIndex: -1,
    globalTokensBefore,
    tokensAfterSubcommand: [],
  };
}
