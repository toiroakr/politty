import { describe, expect, it } from "vitest";
import { parseFrontmatter, parseSkillMd, skillFrontmatterSchema } from "../frontmatter.js";

describe("parseFrontmatter", () => {
  it("should parse basic frontmatter", () => {
    const result = parseFrontmatter(`---
name: commit
description: Git commit message generation
---
# Instructions`);

    expect(result.data).toEqual({
      name: "commit",
      description: "Git commit message generation",
    });
    expect(result.body).toBe("# Instructions");
  });

  it("should strip UTF-8 BOM before matching the fence", () => {
    const result = parseFrontmatter(`\uFEFF---
name: commit
description: hello
---
body`);

    expect(result.data).toEqual({ name: "commit", description: "hello" });
    expect(result.body).toBe("body");
  });

  it("should parse quoted string values", () => {
    const result = parseFrontmatter(`---
name: commit
license: "MIT"
---
body`);

    expect(result.data.license).toBe("MIT");
  });

  it("should parse single-quoted values", () => {
    const result = parseFrontmatter(`---
name: 'my-skill'
---
`);

    expect(result.data.name).toBe("my-skill");
  });

  it("should parse nested metadata (indented)", () => {
    const result = parseFrontmatter(`---
name: test
metadata:
  owner: alice
  priority: high
---
`);

    expect(result.data.metadata).toEqual({
      owner: "alice",
      priority: "high",
    });
  });

  it("should skip comments", () => {
    const result = parseFrontmatter(`---
# This is a comment
name: test
description: hello
---
`);

    expect(result.data).toEqual({
      name: "test",
      description: "hello",
    });
  });

  it("should return empty data when no frontmatter", () => {
    const result = parseFrontmatter("# Just content\nNo frontmatter here.");

    expect(result.data).toEqual({});
    expect(result.body).toBe("# Just content\nNo frontmatter here.");
  });

  it("should handle CRLF line endings", () => {
    const result = parseFrontmatter("---\r\nname: test\r\n---\r\nbody");

    expect(result.data.name).toBe("test");
    expect(result.body).toBe("body");
  });
});

describe("parseSkillMd", () => {
  it("should parse valid SKILL.md", () => {
    const result = parseSkillMd(`---
name: commit
description: Git commit message generation
license: MIT
---
# Commit Skill

Instructions for generating commit messages.`);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe("commit");
    expect(result!.frontmatter.description).toBe("Git commit message generation");
    expect(result!.frontmatter.license).toBe("MIT");
    expect(result!.body).toContain("# Commit Skill");
  });

  it("should return null for missing required fields", () => {
    const result = parseSkillMd(`---
name: commit
---
Missing description`);

    expect(result).toBeNull();
  });

  it("should return null for empty name", () => {
    const result = parseSkillMd(`---
name: ""
description: A test skill
---
`);

    expect(result).toBeNull();
  });

  it("should return null for empty description", () => {
    const result = parseSkillMd(`---
name: test
description: ""
---
`);

    expect(result).toBeNull();
  });

  it("should return null for content without frontmatter", () => {
    const result = parseSkillMd("# Just markdown");

    expect(result).toBeNull();
  });

  it("should accept optional string-valued metadata", () => {
    const result = parseSkillMd(`---
name: test
description: A test skill
metadata:
  politty-cli: "@my-agent/skills:my-agent"
---
`);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.metadata).toEqual({
      "politty-cli": "@my-agent/skills:my-agent",
    });
  });
});

describe("skillFrontmatterSchema", () => {
  it("should validate minimal frontmatter", () => {
    const result = skillFrontmatterSchema.safeParse({
      name: "test",
      description: "A test",
    });

    expect(result.success).toBe(true);
  });

  it("should reject missing name", () => {
    const result = skillFrontmatterSchema.safeParse({
      description: "A test",
    });

    expect(result.success).toBe(false);
  });

  it("should reject missing description", () => {
    const result = skillFrontmatterSchema.safeParse({
      name: "test",
    });

    expect(result.success).toBe(false);
  });

  it("should reject description longer than 1024", () => {
    const result = skillFrontmatterSchema.safeParse({
      name: "test",
      description: "x".repeat(1025),
    });

    expect(result.success).toBe(false);
  });

  it("should reject name longer than 64", () => {
    const result = skillFrontmatterSchema.safeParse({
      name: "a".repeat(65),
      description: "ok",
    });

    expect(result.success).toBe(false);
  });

  it("should reject compatibility longer than 500", () => {
    const result = skillFrontmatterSchema.safeParse({
      name: "test",
      description: "ok",
      compatibility: "x".repeat(501),
    });

    expect(result.success).toBe(false);
  });

  it("should reject non-string metadata values (spec: string->string)", () => {
    const result = skillFrontmatterSchema.safeParse({
      name: "test",
      description: "ok",
      metadata: { flag: true },
    });

    expect(result.success).toBe(false);
  });

  it("should accept full spec-compliant frontmatter", () => {
    const result = skillFrontmatterSchema.safeParse({
      name: "commit",
      description: "Commit skill",
      license: "MIT",
      compatibility: "claude-code>=1.0",
      metadata: { "politty-cli": "@my-agent/skills:my-agent" },
      "allowed-tools": "Read,Write",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.license).toBe("MIT");
      expect(result.data["allowed-tools"]).toBe("Read,Write");
    }
  });

  it("should pass through unknown fields without validating them", () => {
    const result = skillFrontmatterSchema.safeParse({
      name: "test",
      description: "ok",
      customField: { deeply: { nested: 123 } },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).customField).toEqual({
        deeply: { nested: 123 },
      });
    }
  });

  it.each([
    ["../escape", "relative path traversal"],
    ["/absolute/path", "absolute path"],
    ["skill/nested", "path separator"],
    ["skill\\backslash", "backslash"],
    [".", "single dot"],
    ["..", "double dot"],
    ["skill name", "whitespace"],
    ["skill@special", "special characters"],
    ["Skill", "uppercase"],
    ["skill_v2", "underscore"],
    ["a.b.c", "dots"],
    ["-leading", "leading hyphen"],
    ["trailing-", "trailing hyphen"],
    ["double--hyphen", "double hyphen"],
  ])("should reject unsafe name %j (%s)", (name) => {
    const result = skillFrontmatterSchema.safeParse({
      name,
      description: "test",
    });

    expect(result.success).toBe(false);
  });

  it.each([["commit"], ["my-skill"], ["review-pr"], ["skill1"], ["a1-b2-c3"]])(
    "should accept spec-compliant name %j",
    (name) => {
      const result = skillFrontmatterSchema.safeParse({
        name,
        description: "test",
      });

      expect(result.success).toBe(true);
    },
  );
});
