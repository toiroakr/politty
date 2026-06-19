import { describe, expect, it } from "vitest";
import { z } from "zod";
import { arg } from "../core/arg-registry.js";
import { extractFields } from "../core/schema-extractor.js";
import { buildParserOptions } from "./argv-parser.js";
import { resolveLongOption, type LongOptionLookup } from "./long-option-resolver.js";
import { buildGlobalFlagLookup, resolveGlobalLongOption } from "./subcommand-scanner.js";

/**
 * Scanner / parser symmetry test.
 *
 * Exercises a corpus of long-option shapes and asserts both phases agree on
 * whether each token is a recognized global flag, negation, or unknown.
 */
describe("scanner / parser symmetry", () => {
  const schema = z.object({
    verbose: arg(z.boolean().default(false), { description: "Verbose" }),
    "dry-run": arg(z.boolean().default(false), { description: "Dry run" }),
    config: arg(z.string().optional(), { description: "Config file" }),
    cache: arg(z.boolean().default(true), {
      description: "Enable cache",
      negation: "disable-cache",
    }),
    "no-foo": arg(z.boolean().default(false), { description: "No foo flag" }),
    noBar: arg(z.boolean().default(false), { description: "No bar flag" }),
    color: arg(z.boolean().default(true), {
      description: "Color",
      negation: false,
    }),
  });

  const extracted = extractFields(schema);
  const parserOptions = buildParserOptions(extracted);
  const lookup = buildGlobalFlagLookup(extracted);

  interface TestCase {
    token: string;
    expectedRecognized: boolean;
    expectedNegated: boolean;
    label: string;
  }

  const corpus: TestCase[] = [
    {
      token: "--verbose",
      expectedRecognized: true,
      expectedNegated: false,
      label: "plain boolean",
    },
    {
      token: "--dry-run",
      expectedRecognized: true,
      expectedNegated: false,
      label: "kebab boolean",
    },
    { token: "--config", expectedRecognized: true, expectedNegated: false, label: "string option" },
    {
      token: "--config=app.json",
      expectedRecognized: true,
      expectedNegated: false,
      label: "string with =value",
    },

    // Default negation
    {
      token: "--no-verbose",
      expectedRecognized: true,
      expectedNegated: true,
      label: "kebab negation",
    },
    {
      token: "--noVerbose",
      expectedRecognized: true,
      expectedNegated: true,
      label: "camelCase negation",
    },
    {
      token: "--no-dry-run",
      expectedRecognized: true,
      expectedNegated: true,
      label: "kebab negation of kebab field",
    },
    {
      token: "--noDryRun",
      expectedRecognized: true,
      expectedNegated: true,
      label: "camelCase negation of kebab field",
    },

    // Custom negation
    {
      token: "--disable-cache",
      expectedRecognized: true,
      expectedNegated: true,
      label: "custom negation",
    },
    {
      token: "--disableCache",
      expectedRecognized: true,
      expectedNegated: true,
      label: "custom negation camelCase",
    },

    // Suppressed default negation (custom negation configured)
    {
      token: "--no-cache",
      expectedRecognized: false,
      expectedNegated: false,
      label: "suppressed default negation (custom configured)",
    },
    {
      token: "--noCache",
      expectedRecognized: false,
      expectedNegated: false,
      label: "suppressed camelCase negation (custom configured)",
    },

    // Suppressed negation (negation: false)
    {
      token: "--no-color",
      expectedRecognized: false,
      expectedNegated: false,
      label: "suppressed default negation (negation: false)",
    },
    {
      token: "--noColor",
      expectedRecognized: false,
      expectedNegated: false,
      label: "suppressed camelCase negation (negation: false)",
    },

    // Literal-name disambiguation
    {
      token: "--no-foo",
      expectedRecognized: true,
      expectedNegated: false,
      label: "literal no-foo field (not negation of foo)",
    },
    {
      token: "--noBar",
      expectedRecognized: true,
      expectedNegated: false,
      label: "literal noBar field (not negation of bar)",
    },

    // Unknown
    {
      token: "--unknown",
      expectedRecognized: false,
      expectedNegated: false,
      label: "unknown flag",
    },
    {
      token: "--no-unknown",
      expectedRecognized: false,
      expectedNegated: false,
      label: "negation of unknown flag",
    },

    // Mixed form (blocked)
    {
      token: "--no-dryRun",
      expectedRecognized: false,
      expectedNegated: false,
      label: "mixed form --no-dryRun (blocked)",
    },

    // Negation with =value (not negation — = syntax overrides)
    {
      token: "--no-verbose=true",
      expectedRecognized: false,
      expectedNegated: false,
      label: "--no-flag=value is not negation",
    },
    {
      token: "--noVerbose=true",
      expectedRecognized: false,
      expectedNegated: false,
      label: "--noFlag=value is not negation",
    },
  ];

  function scannerRecognizes(token: string): { recognized: boolean; negated: boolean } {
    const globalResult = resolveGlobalLongOption(token, lookup);
    return { recognized: globalResult.isGlobal, negated: globalResult.isNegated };
  }

  function parserRecognizes(token: string): { recognized: boolean; negated: boolean } {
    const resolution = resolveLongOption(token, parserOptions as LongOptionLookup);
    if (resolution.isSuppressedNegation) {
      return { recognized: false, negated: false };
    }
    if (resolution.isNegated) {
      return { recognized: true, negated: true };
    }
    // Check if the resolved name matches a known field
    const bareToken = token.includes("=") ? token.slice(2, token.indexOf("=")) : token.slice(2);
    const isKnown =
      parserOptions.definedNames!.has(resolution.resolvedName) ||
      parserOptions.aliasMap!.has(bareToken);
    return { recognized: isKnown, negated: false };
  }

  for (const tc of corpus) {
    it(`${tc.label}: ${tc.token}`, () => {
      const scanner = scannerRecognizes(tc.token);
      const parser = parserRecognizes(tc.token);

      expect(scanner.recognized).toBe(tc.expectedRecognized);
      expect(scanner.negated).toBe(tc.expectedNegated);

      expect(parser.recognized).toBe(tc.expectedRecognized);
      expect(parser.negated).toBe(tc.expectedNegated);

      // Both phases must agree
      expect(scanner).toEqual(parser);
    });
  }
});

describe("resolveLongOption", () => {
  it("returns isCustomNegation: true for custom negation", () => {
    const lookup: LongOptionLookup = {
      aliasMap: new Map(),
      booleanFlags: new Set(["cache"]),
      definedNames: new Set(["cache"]),
      negationMap: new Map([["disable-cache", "cache"]]),
      customNegatedFields: new Set(["cache"]),
    };

    const result = resolveLongOption("--disable-cache", lookup);
    expect(result.isNegated).toBe(true);
    expect(result.isCustomNegation).toBe(true);
    expect(result.resolvedName).toBe("cache");
  });

  it("returns isSuppressedNegation: true for suppressed default negation", () => {
    const lookup: LongOptionLookup = {
      aliasMap: new Map(),
      booleanFlags: new Set(["cache"]),
      definedNames: new Set(["cache"]),
      negationMap: new Map([["disable-cache", "cache"]]),
      customNegatedFields: new Set(["cache"]),
    };

    const result = resolveLongOption("--no-cache", lookup);
    expect(result.isNegated).toBe(false);
    expect(result.isSuppressedNegation).toBe(true);
    expect(result.resolvedName).toBe("cache");
  });

  it("does not match custom negation with = syntax", () => {
    const lookup: LongOptionLookup = {
      aliasMap: new Map(),
      booleanFlags: new Set(["cache"]),
      definedNames: new Set(["cache"]),
      negationMap: new Map([["disable-cache", "cache"]]),
      customNegatedFields: new Set(["cache"]),
    };

    const result = resolveLongOption("--disable-cache=true", lookup);
    expect(result.isNegated).toBe(false);
    expect(result.isCustomNegation).toBe(false);
  });
});
