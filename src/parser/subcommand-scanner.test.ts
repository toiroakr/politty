import { describe, expect, it } from "vitest";
import { z } from "zod";
import { arg } from "../core/arg-registry.js";
import { extractFields } from "../core/schema-extractor.js";
import { findFirstPositionalIndex, scanForSubcommand } from "./subcommand-scanner.js";

describe("scanForSubcommand", () => {
  const globalSchema = z.object({
    verbose: arg(z.boolean().default(false), {
      alias: "v",
      description: "Verbose",
      negation: true,
    }),
    config: arg(z.string().optional(), { description: "Config file" }),
  });
  const globalExtracted = extractFields(globalSchema);
  const subCommandNames = ["build", "deploy"];

  it("finds subcommand with no global flags", () => {
    const result = scanForSubcommand(
      ["build", "--output", "dist"],
      subCommandNames,
      globalExtracted,
    );

    expect(result.subCommandIndex).toBe(0);
    expect(result.globalTokensBefore).toEqual([]);
    expect(result.tokensAfterSubcommand).toEqual(["--output", "dist"]);
  });

  it("skips boolean global flag before subcommand", () => {
    const result = scanForSubcommand(
      ["--verbose", "build", "--output", "dist"],
      subCommandNames,
      globalExtracted,
    );

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual(["--verbose"]);
    expect(result.tokensAfterSubcommand).toEqual(["--output", "dist"]);
  });

  it("skips global flag with value before subcommand", () => {
    const result = scanForSubcommand(
      ["--config", "app.json", "deploy"],
      subCommandNames,
      globalExtracted,
    );

    expect(result.subCommandIndex).toBe(2);
    expect(result.globalTokensBefore).toEqual(["--config", "app.json"]);
    expect(result.tokensAfterSubcommand).toEqual([]);
  });

  it("skips short alias before subcommand", () => {
    const result = scanForSubcommand(["-v", "build"], subCommandNames, globalExtracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual(["-v"]);
    expect(result.tokensAfterSubcommand).toEqual([]);
  });

  it("handles multiple global flags before subcommand", () => {
    const result = scanForSubcommand(
      ["--verbose", "--config", "custom.json", "build", "--output", "out"],
      subCommandNames,
      globalExtracted,
    );

    expect(result.subCommandIndex).toBe(3);
    expect(result.globalTokensBefore).toEqual(["--verbose", "--config", "custom.json"]);
    expect(result.tokensAfterSubcommand).toEqual(["--output", "out"]);
  });

  it("handles --flag=value syntax", () => {
    const result = scanForSubcommand(
      ["--config=app.json", "build"],
      subCommandNames,
      globalExtracted,
    );

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual(["--config=app.json"]);
  });

  it("returns -1 when no subcommand found", () => {
    const result = scanForSubcommand(["--verbose"], subCommandNames, globalExtracted);

    expect(result.subCommandIndex).toBe(-1);
    expect(result.globalTokensBefore).toEqual(["--verbose"]);
    expect(result.tokensAfterSubcommand).toEqual([]);
  });

  it("stops on -- separator", () => {
    const result = scanForSubcommand(
      ["--verbose", "--", "build"],
      subCommandNames,
      globalExtracted,
    );

    expect(result.subCommandIndex).toBe(-1);
  });

  it("stops on --help", () => {
    const result = scanForSubcommand(["--verbose", "--help"], subCommandNames, globalExtracted);

    expect(result.subCommandIndex).toBe(-1);
  });

  it("stops on -h", () => {
    const result = scanForSubcommand(["-h"], subCommandNames, globalExtracted);

    expect(result.subCommandIndex).toBe(-1);
  });

  it("stops on --version", () => {
    const result = scanForSubcommand(["--version"], subCommandNames, globalExtracted);

    expect(result.subCommandIndex).toBe(-1);
  });

  it("stops on unknown long flag (not global)", () => {
    const result = scanForSubcommand(["--unknown", "build"], subCommandNames, globalExtracted);

    expect(result.subCommandIndex).toBe(-1);
  });

  it("stops on unknown short flag", () => {
    const result = scanForSubcommand(["-x", "build"], subCommandNames, globalExtracted);

    expect(result.subCommandIndex).toBe(-1);
  });

  it("handles --no-flag negation for boolean global", () => {
    const result = scanForSubcommand(["--no-verbose", "build"], subCommandNames, globalExtracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual(["--no-verbose"]);
  });

  it("handles --noFlag camelCase negation for opt-in boolean global", () => {
    const result = scanForSubcommand(["--noVerbose", "build"], subCommandNames, globalExtracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual(["--noVerbose"]);
  });

  it("handles camelCase negation for opt-in kebab-case field name", () => {
    const schemaWithKebab = z.object({
      "dry-run": arg(z.boolean().default(false), { description: "Dry run", negation: true }),
    });
    const extracted = extractFields(schemaWithKebab);
    const result = scanForSubcommand(["--noDryRun", "build"], subCommandNames, extracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual(["--noDryRun"]);
  });

  it("keeps scanning past disabled-by-default --no-X and surfaces it as a suppressed token", () => {
    const schemaWithoutNegation = z.object({
      cache: arg(z.boolean().default(true), {
        description: "Enable cache",
      }),
    });
    const extracted = extractFields(schemaWithoutNegation);
    const result = scanForSubcommand(["--no-cache", "build"], subCommandNames, extracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual([]);
    expect(result.suppressedTokens).toEqual(["no-cache"]);
  });

  it("treats --no-foo as a positive flag when a global is literally named 'no-foo'", () => {
    // Mirrors argv-parser's `definedNames` disambiguation: when the literal
    // token `no-foo` matches a real global option, it should not be treated
    // as the negation of an imagined `foo` field.
    const schemaLiteralNo = z.object({
      "no-foo": arg(z.boolean().default(false), { description: "No foo" }),
    });
    const extracted = extractFields(schemaLiteralNo);
    const result = scanForSubcommand(["--no-foo", "build"], subCommandNames, extracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual(["--no-foo"]);
  });

  it("keeps scanning past suppressed default --no-X and surfaces it as a suppressed token", () => {
    // When a global boolean is configured with `negation: "disable-cache"`,
    // the default `--no-cache` token is suppressed (no longer negates the
    // field) but must not stop subcommand scanning — otherwise routing for
    // `cli --no-cache build` would break. The token is reported separately
    // via `suppressedTokens` so the caller can surface it as an unknown flag.
    const schemaWithCustomNegation = z.object({
      cache: arg(z.boolean().default(true), {
        description: "Enable cache",
        negation: "disable-cache",
      }),
    });
    const extracted = extractFields(schemaWithCustomNegation);
    const result = scanForSubcommand(["--no-cache", "build"], subCommandNames, extracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual([]);
    expect(result.suppressedTokens).toEqual(["no-cache"]);
  });

  it("keeps scanning past suppressed camelCase --noX and surfaces it as a suppressed token", () => {
    const schemaWithCustomNegation = z.object({
      dryRun: arg(z.boolean().default(false), {
        description: "Dry run",
        negation: "execute",
      }),
    });
    const extracted = extractFields(schemaWithCustomNegation);
    const result = scanForSubcommand(["--noDryRun", "build"], subCommandNames, extracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual([]);
    expect(result.suppressedTokens).toEqual(["noDryRun"]);
  });

  it("treats --noBar as a positive flag when a global is literally named 'noBar'", () => {
    const schemaLiteralCamel = z.object({
      noBar: arg(z.boolean().default(false), { description: "No bar" }),
    });
    const extracted = extractFields(schemaLiteralCamel);
    const result = scanForSubcommand(["--noBar", "build"], subCommandNames, extracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual(["--noBar"]);
  });

  it("ignores non-subcommand positional argument", () => {
    const result = scanForSubcommand(["unknown-cmd"], subCommandNames, globalExtracted);

    expect(result.subCommandIndex).toBe(-1);
  });

  it("handles empty argv", () => {
    const result = scanForSubcommand([], subCommandNames, globalExtracted);

    expect(result.subCommandIndex).toBe(-1);
    expect(result.globalTokensBefore).toEqual([]);
    expect(result.tokensAfterSubcommand).toEqual([]);
  });
});

describe("findFirstPositionalIndex", () => {
  const globalSchema = z.object({
    verbose: arg(z.boolean().default(false), { alias: "v", description: "Verbose" }),
    config: arg(z.string().optional(), { description: "Config file" }),
  });
  const globalExtracted = extractFields(globalSchema);

  it("returns the first non-flag token", () => {
    expect(findFirstPositionalIndex(["plugin", "--flag"], globalExtracted)).toBe(0);
  });

  it("skips global flag values before the positional", () => {
    expect(findFirstPositionalIndex(["--config", "app.json", "plugin"], globalExtracted)).toBe(2);
  });

  it("skips short global aliases before the positional", () => {
    expect(findFirstPositionalIndex(["-v", "plugin"], globalExtracted)).toBe(1);
  });

  it("stops at builtin --help (does not misclassify the trailing token)", () => {
    expect(findFirstPositionalIndex(["--help", "plugin"], globalExtracted)).toBe(-1);
  });

  it("stops at builtin --version", () => {
    expect(findFirstPositionalIndex(["--version", "plugin"], globalExtracted)).toBe(-1);
  });

  it("stops at an unknown long flag", () => {
    expect(findFirstPositionalIndex(["--unknown", "value"], globalExtracted)).toBe(-1);
  });

  it("stops at an unknown short flag", () => {
    expect(findFirstPositionalIndex(["-x", "value", "plugin"], globalExtracted)).toBe(-1);
  });

  it("stops at combined short flags", () => {
    expect(findFirstPositionalIndex(["-abc", "plugin"], globalExtracted)).toBe(-1);
  });

  it("stops at the `--` terminator", () => {
    expect(findFirstPositionalIndex(["--", "plugin"], globalExtracted)).toBe(-1);
  });

  it("returns -1 when no positional is present", () => {
    expect(findFirstPositionalIndex(["--verbose"], globalExtracted)).toBe(-1);
  });

  it("without a schema, returns a leading positional", () => {
    expect(findFirstPositionalIndex(["plugin", "--unknown", "value"])).toBe(0);
  });

  it("without a schema, stops at a leading flag (nothing is global)", () => {
    expect(findFirstPositionalIndex(["--unknown", "value", "plugin"])).toBe(-1);
  });

  it("keeps scanning past a suppressed default --no-X for a custom-negation field", () => {
    const schemaWithCustomNegation = z.object({
      dryRun: arg(z.boolean().default(false), { description: "Dry run", negation: "execute" }),
    });
    const extracted = extractFields(schemaWithCustomNegation);
    expect(findFirstPositionalIndex(["--no-dry-run", "plugin"], extracted)).toBe(1);
  });
});
