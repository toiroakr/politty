import { describe, expectTypeOf, it } from "vitest";

import type { CamelCase, KebabCase, WithCaseVariants } from "./case-types.js";

describe("CamelCase type", () => {
  it("converts kebab-case to camelCase", () => {
    expectTypeOf<CamelCase<"my-option">>().toEqualTypeOf<"myOption">();
  });

  it("converts multi-hyphen kebab-case", () => {
    expectTypeOf<CamelCase<"my-long-option">>().toEqualTypeOf<"myLongOption">();
  });

  it("leaves camelCase unchanged", () => {
    expectTypeOf<CamelCase<"myOption">>().toEqualTypeOf<"myOption">();
  });

  it("leaves single-word unchanged", () => {
    expectTypeOf<CamelCase<"verbose">>().toEqualTypeOf<"verbose">();
  });
});

describe("KebabCase type", () => {
  it("converts camelCase to kebab-case", () => {
    expectTypeOf<KebabCase<"myOption">>().toEqualTypeOf<"my-option">();
  });

  it("converts multi-word camelCase", () => {
    expectTypeOf<KebabCase<"myLongOption">>().toEqualTypeOf<"my-long-option">();
  });

  it("leaves kebab-case unchanged", () => {
    expectTypeOf<KebabCase<"my-option">>().toEqualTypeOf<"my-option">();
  });

  it("leaves single-word unchanged", () => {
    expectTypeOf<KebabCase<"verbose">>().toEqualTypeOf<"verbose">();
  });
});

describe("WithCaseVariants type", () => {
  it("adds camelCase variant for kebab-case keys", () => {
    type Input = { "my-option": string };
    type Result = WithCaseVariants<Input>;
    expectTypeOf<Result>().toMatchTypeOf<{ "my-option": string; myOption: string }>();
  });

  it("adds kebab-case variant for camelCase keys", () => {
    type Input = { myOption: string };
    type Result = WithCaseVariants<Input>;
    expectTypeOf<Result>().toMatchTypeOf<{ myOption: string; "my-option": string }>();
  });

  it("preserves single-word keys without duplication", () => {
    type Input = { verbose: boolean };
    type Result = WithCaseVariants<Input>;
    expectTypeOf<Result>().toMatchTypeOf<{ verbose: boolean }>();
  });

  it("handles mixed keys", () => {
    type Input = { "dry-run": boolean; output: string; logLevel: number };
    type Result = WithCaseVariants<Input>;
    expectTypeOf<Result>().toMatchTypeOf<{
      "dry-run": boolean;
      dryRun: boolean;
      output: string;
      logLevel: number;
      "log-level": number;
    }>();
  });

  it("distributes over unions (discriminated unions)", () => {
    type Input = { action: "create"; name: string } | { action: "delete"; "item-id": number };
    type Result = WithCaseVariants<Input>;
    expectTypeOf<Result>().toMatchTypeOf<
      { action: "create"; name: string } | { action: "delete"; "item-id": number; itemId: number }
    >();
  });
});
