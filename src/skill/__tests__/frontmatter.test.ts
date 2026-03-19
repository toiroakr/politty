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

  it("should parse quoted string values", () => {
    const result = parseFrontmatter(`---
name: commit
package: "@my-agent/skills"
---
body`);

    expect(result.data.package).toBe("@my-agent/skills");
  });

  it("should parse single-quoted values", () => {
    const result = parseFrontmatter(`---
name: 'my-skill'
---
`);

    expect(result.data.name).toBe("my-skill");
  });

  it("should parse boolean values", () => {
    const result = parseFrontmatter(`---
name: test
enabled: true
disabled: false
---
`);

    expect(result.data.enabled).toBe(true);
    expect(result.data.disabled).toBe(false);
  });

  it("should parse null values", () => {
    const result = parseFrontmatter(`---
name: test
empty: null
tilde: ~
---
`);

    expect(result.data.empty).toBeNull();
    expect(result.data.tilde).toBeNull();
  });

  it("should parse flow-style arrays", () => {
    const result = parseFrontmatter(`---
name: test
tags: [git, commit, tools]
---
`);

    expect(result.data.tags).toEqual(["git", "commit", "tools"]);
  });

  it("should parse empty arrays", () => {
    const result = parseFrontmatter(`---
name: test
tags: []
---
`);

    expect(result.data.tags).toEqual([]);
  });

  it("should parse numeric values", () => {
    const result = parseFrontmatter(`---
name: test
version: 42
weight: 1.5
---
`);

    expect(result.data.version).toBe(42);
    expect(result.data.weight).toBe(1.5);
  });

  it("should parse nested objects (indented)", () => {
    const result = parseFrontmatter(`---
name: test
metadata:
  internal: true
  priority: 10
---
`);

    expect(result.data.metadata).toEqual({
      internal: true,
      priority: 10,
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
package: "@my-agent/skills"
---
# Commit Skill

Instructions for generating commit messages.`);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe("commit");
    expect(result!.frontmatter.description).toBe("Git commit message generation");
    expect(result!.frontmatter.package).toBe("@my-agent/skills");
    expect(result!.body).toContain("# Commit Skill");
  });

  it("should return null for missing required fields", () => {
    const result = parseSkillMd(`---
name: commit
---
Missing description`);

    expect(result).toBeNull();
  });

  it("should return null for content without frontmatter", () => {
    const result = parseSkillMd("# Just markdown");

    expect(result).toBeNull();
  });

  it("should accept optional metadata", () => {
    const result = parseSkillMd(`---
name: test
description: A test skill
metadata:
  internal: true
---
`);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.metadata).toEqual({ internal: true });
  });

  it("should accept without package field", () => {
    const result = parseSkillMd(`---
name: test
description: A test skill
---
`);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.package).toBeUndefined();
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

  it("should accept full frontmatter", () => {
    const result = skillFrontmatterSchema.safeParse({
      name: "commit",
      description: "Commit skill",
      package: "@my-agent/skills",
      metadata: { internal: true },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.package).toBe("@my-agent/skills");
    }
  });
});
