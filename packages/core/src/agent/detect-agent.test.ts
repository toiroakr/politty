import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectAgent } from "./index.js";
import { KNOWN_AGENT_IDS } from "./known-agent-ids.js";
import agentsSpec from "./spec/agents.json" with { type: "json" };
import testcasesJson from "./spec/testcases.json" with { type: "json" };

interface SpecTestcase {
  name: string;
  env: Record<string, string>;
  files?: string[];
  tty?: boolean;
  expectedIsAgent: boolean;
  expectedName?: string;
  expectedAgentKey?: string;
}

const testcases: SpecTestcase[] = testcasesJson;

interface SpecCondition {
  type: string;
  conditions?: SpecCondition[];
}

const SUPPORTED_CONDITION_TYPES = new Set([
  "anyOf",
  "allOf",
  "env_set",
  "env_value",
  "env_matches",
  "file_exists",
  "no_tty",
]);

function collectConditionTypes(condition: SpecCondition): string[] {
  return [condition.type, ...(condition.conditions ?? []).flatMap(collectConditionTypes)];
}

function readUpstreamAgentsJson(): unknown {
  const require = createRequire(import.meta.url);
  const upstreamDir = dirname(require.resolve("detect-agent"));
  return JSON.parse(readFileSync(join(upstreamDir, "..", "agents.json"), "utf8"));
}

describe("vendored detect-agent spec", () => {
  it("is identical to the agents.json of the installed detect-agent devDependency", () => {
    expect(agentsSpec).toEqual(readUpstreamAgentsJson());
  });

  it("is spec version 1", () => {
    expect(agentsSpec.version).toBe(1);
  });

  it("uses only condition types the evaluator supports", () => {
    const types = agentsSpec.agents.flatMap((agent) =>
      collectConditionTypes(agent.match as SpecCondition),
    );
    expect(types.filter((type) => !SUPPORTED_CONDITION_TYPES.has(type))).toEqual([]);
  });

  it("lists every agent name in KNOWN_AGENT_IDS in spec order", () => {
    expect([...KNOWN_AGENT_IDS]).toEqual(agentsSpec.agents.map((agent) => agent.name));
  });
});

describe("detectAgent against the shared detect-agent testcases", () => {
  const nameByKey = new Map(agentsSpec.agents.map((agent) => [agent.key, agent.name]));

  for (const testcase of testcases) {
    it(testcase.name, () => {
      const files = new Set(testcase.files);
      const result = detectAgent(testcase.env, {
        isTTY: testcase.tty,
        fileExists: (path) => files.has(path),
      });

      if (!testcase.expectedIsAgent) {
        expect(result).toBeUndefined();
        return;
      }
      const expectedId = testcase.expectedName ?? nameByKey.get(testcase.expectedAgentKey ?? "");
      expect(result?.rawId).toBe(expectedId);
    });
  }
});

describe("detectAgent", () => {
  it("returns undefined when POLITTY_NO_AGENT is set, even if an agent is detected", () => {
    expect(detectAgent({ CLAUDECODE: "1", POLITTY_NO_AGENT: "1" })).toBeUndefined();
  });

  it("returns undefined when POLITTY_NO_AGENT is set, even if AI_AGENT forces an agent", () => {
    expect(detectAgent({ AI_AGENT: "my-agent", POLITTY_NO_AGENT: "1" })).toBeUndefined();
  });

  it("ignores an empty POLITTY_NO_AGENT", () => {
    expect(detectAgent({ CLAUDECODE: "1", POLITTY_NO_AGENT: "" })?.id).toBe("claude_code");
  });

  it("trims the AI_AGENT override", () => {
    expect(detectAgent({ AI_AGENT: "  my-agent  " })?.rawId).toBe("my-agent");
  });

  it("reports the matched spec name as both id and rawId when no AI_AGENT is set", () => {
    expect(detectAgent({ CLAUDECODE: "1" })).toStrictEqual({
      id: "claude_code",
      rawId: "claude_code",
    });
  });

  it("reports the spec match as id and a custom AI_AGENT as rawId", () => {
    expect(detectAgent({ AI_AGENT: "claude-code_2-1-284_agent", CLAUDECODE: "1" })).toStrictEqual({
      id: "claude_code",
      rawId: "claude-code_2-1-284_agent",
    });
  });

  it("prefers AI_AGENT over the spec match for id when AI_AGENT is a known spec name", () => {
    expect(detectAgent({ AI_AGENT: "codex_cli", CLAUDECODE: "1" })).toStrictEqual({
      id: "codex_cli",
      rawId: "codex_cli",
    });
  });

  it("falls back to the custom AI_AGENT for id when no spec agent matches", () => {
    expect(detectAgent({ AI_AGENT: "my-agent" })).toStrictEqual({
      id: "my-agent",
      rawId: "my-agent",
    });
  });

  it("returns undefined instead of throwing when the file check throws", () => {
    expect(
      detectAgent(
        {},
        {
          fileExists: () => {
            throw new Error("boom");
          },
        },
      ),
    ).toBeUndefined();
  });
});
