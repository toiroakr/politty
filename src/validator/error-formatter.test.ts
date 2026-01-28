import { describe, expect, it } from "vitest";
import {
  formatRuntimeError,
  formatUnknownFlag,
  formatValidationErrors,
} from "./error-formatter.js";
import type { ValidationError } from "./zod-validator.js";

/**
 * Task 5.2: Error Formatter Tests
 * - Convert validation errors into human-readable messages
 * - Display multiple errors in a consolidated format
 * - Suggest similar options for unknown flags
 * - Show stack traces in debug mode
 */
describe("ErrorFormatter", () => {
  describe("formatValidationErrors", () => {
    it("should format a single error", () => {
      const errors: ValidationError[] = [
        {
          path: ["name"],
          message: "Required",
          code: "invalid_type",
        },
      ];

      const result = formatValidationErrors(errors);

      expect(result).toContain("name");
      expect(result).toContain("Required");
    });

    it("should format multiple errors", () => {
      const errors: ValidationError[] = [
        {
          path: ["name"],
          message: "Required",
          code: "invalid_type",
        },
        {
          path: ["age"],
          message: "Must be positive",
          code: "too_small",
        },
      ];

      const result = formatValidationErrors(errors);

      expect(result).toContain("name");
      expect(result).toContain("age");
      expect(result).toContain("Required");
      expect(result).toContain("positive");
    });

    it("should handle nested paths", () => {
      const errors: ValidationError[] = [
        {
          path: ["config", "port"],
          message: "Invalid port",
          code: "invalid_type",
        },
      ];

      const result = formatValidationErrors(errors);

      expect(result).toContain("config.port");
    });

    it("should return empty string for no errors", () => {
      const result = formatValidationErrors([]);

      expect(result).toBe("");
    });
  });

  describe("formatUnknownFlag", () => {
    it("should format unknown flag message", () => {
      const result = formatUnknownFlag("--verbos", ["verbose", "version", "help"]);

      expect(result).toContain("verbos");
      expect(result).toContain("Unknown");
    });

    it("should suggest similar flags", () => {
      const result = formatUnknownFlag("--verbos", ["verbose", "version", "help"]);

      expect(result).toContain("verbose");
    });

    it("should handle no similar flags", () => {
      const result = formatUnknownFlag("--xyz", ["foo", "bar"]);

      expect(result).toContain("xyz");
      expect(result).toContain("Unknown");
    });
  });

  describe("formatRuntimeError", () => {
    it("should format error message", () => {
      const error = new Error("Something went wrong");

      const result = formatRuntimeError(error, false);

      expect(result).toContain("Something went wrong");
    });

    it("should include stack trace in debug mode", () => {
      const error = new Error("Test error");

      const result = formatRuntimeError(error, true);

      expect(result).toContain("Test error");
      expect(result).toContain("at "); // Stack trace contains "at "
    });

    it("should not include stack trace in normal mode", () => {
      const error = new Error("Test error");

      const result = formatRuntimeError(error, false);

      expect(result).toContain("Test error");
      // In non-debug mode, output should be simpler
      expect(result.split("\n").length).toBeLessThan(10);
    });
  });
});
