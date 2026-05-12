import { describe, expect, it } from "vitest";
import { z } from "zod";
import { arg } from "../core/arg-registry.js";
import { extractFields } from "../core/schema-extractor.js";
import { scanForSubcommand } from "./subcommand-scanner.js";

describe("scanForSubcommand", () => {
  const globalSchema = z.object({
    verbose: arg(z.boolean().default(false), { alias: "v", description: "Verbose" }),
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

  it("handles --noFlag camelCase negation for boolean global", () => {
    const result = scanForSubcommand(["--noVerbose", "build"], subCommandNames, globalExtracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual(["--noVerbose"]);
  });

  it("handles camelCase negation for kebab-case field name", () => {
    const schemaWithKebab = z.object({
      "dry-run": arg(z.boolean().default(false), { description: "Dry run" }),
    });
    const extracted = extractFields(schemaWithKebab);
    const result = scanForSubcommand(["--noDryRun", "build"], subCommandNames, extracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual(["--noDryRun"]);
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

  it("keeps scanning past suppressed default --no-X when the field has a custom negation", () => {
    // When a global boolean is configured with `negation: "disable-cache"`,
    // the default `--no-cache` token is suppressed (no longer negates the
    // field) but must not stop subcommand scanning — otherwise routing for
    // `cli --no-cache build` would break.
    const schemaWithCustomNegation = z.object({
      cache: arg(z.boolean().default(true), {
        description: "Enable cache",
        negation: "disable-cache",
      }),
    });
    const extracted = extractFields(schemaWithCustomNegation);
    const result = scanForSubcommand(["--no-cache", "build"], subCommandNames, extracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual(["--no-cache"]);
  });

  it("keeps scanning past suppressed camelCase --noX when the field has a custom negation", () => {
    const schemaWithCustomNegation = z.object({
      dryRun: arg(z.boolean().default(false), {
        description: "Dry run",
        negation: "execute",
      }),
    });
    const extracted = extractFields(schemaWithCustomNegation);
    const result = scanForSubcommand(["--noDryRun", "build"], subCommandNames, extracted);

    expect(result.subCommandIndex).toBe(1);
    expect(result.globalTokensBefore).toEqual(["--noDryRun"]);
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
