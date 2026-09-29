/*! Agent detection data from vercel/detect-agent (https://github.com/vercel/detect-agent), Copyright Vercel, Inc., Apache-2.0 (http://www.apache.org/licenses/LICENSE-2.0) */
import { existsSync } from "node:fs";
import { KNOWN_AGENT_IDS } from "./known-agent-ids.js";
import spec from "./spec/agents.json" with { type: "json" };

/**
 * Agent name defined by the detect-agent spec (e.g. `"claude_code"`,
 * `"codex_cli"`). Names follow upstream and may change with it.
 */
export type KnownAgentId = (typeof KNOWN_AGENT_IDS)[number];

/**
 * An AI coding agent detected from the environment.
 */
export interface AgentInfo {
  /**
   * The spec's name for the agent: `AI_AGENT` when it is a known name,
   * otherwise the first spec agent whose markers match, falling back to the
   * custom `AI_AGENT` value when none does.
   */
  id: KnownAgentId | (string & {});
  /**
   * The id as the detect-agent spec reports it: the trimmed `AI_AGENT` value
   * when non-empty (e.g. `"claude-code_2-1-284_agent"`), otherwise the same as
   * `id`.
   */
  rawId: string;
}

/**
 * Overrides for the non-env inputs of {@link detectAgent}, mainly for tests.
 */
export interface DetectAgentOptions {
  /** Whether stdout is a TTY (default: `process.stdout.isTTY`) */
  isTTY?: boolean | undefined;
  /** File existence check (default: `fs.existsSync`) */
  fileExists?: ((path: string) => boolean) | undefined;
}

type Env = Readonly<Record<string, string | undefined>>;

type Condition =
  | { type: "env_set"; name: string }
  | { type: "env_value"; name: string; value: string }
  | { type: "env_matches"; name: string; pattern: string }
  | { type: "file_exists"; path: string }
  | { type: "no_tty" }
  | { type: "anyOf"; conditions: Condition[] }
  | { type: "allOf"; conditions: Condition[] };

interface Probes {
  isTTY: boolean;
  fileExists: (path: string) => boolean;
}

interface AgentSpec {
  name: string;
  match: Condition;
}

const OPT_OUT_VAR = "POLITTY_NO_AGENT";
const agents = spec.agents as AgentSpec[];
const knownIds: ReadonlySet<string> = new Set(KNOWN_AGENT_IDS);

function isKnownAgentId(id: string): id is KnownAgentId {
  return knownIds.has(id);
}

function evaluate(condition: Condition, env: Env, probes: Probes): boolean {
  switch (condition.type) {
    case "env_set":
      return Boolean(env[condition.name]);
    case "env_value":
      return env[condition.name] === condition.value;
    case "env_matches": {
      const value = env[condition.name];
      if (!value) return false;
      try {
        return new RegExp(condition.pattern).test(value);
      } catch {
        return false;
      }
    }
    case "no_tty":
      return !probes.isTTY;
    case "file_exists":
      try {
        return probes.fileExists(condition.path);
      } catch {
        return false;
      }
    case "anyOf":
      return condition.conditions.some((sub) => evaluate(sub, env, probes));
    case "allOf":
      return condition.conditions.every((sub) => evaluate(sub, env, probes));
    default:
      return false;
  }
}

/**
 * Detect whether the process runs under an AI coding agent, following the
 * [detect-agent](https://github.com/vercel/detect-agent) spec: a non-empty
 * `AI_AGENT` (trimmed) wins as `rawId`, then the spec's agents are checked in
 * order. `id` normalizes the result to a spec name when possible.
 * `POLITTY_NO_AGENT` (any non-empty value) disables detection. Never throws.
 *
 * @param env - Environment to inspect (default: `process.env`)
 * @returns The detected agent, or `undefined`
 */
export function detectAgent(
  env: Env = process.env,
  options: DetectAgentOptions = {},
): AgentInfo | undefined {
  try {
    if (env[OPT_OUT_VAR]) return undefined;

    const override = env[spec.aiAgentVar]?.trim();
    if (override && isKnownAgentId(override)) return { id: override, rawId: override };

    const probes: Probes = {
      isTTY: options.isTTY ?? process.stdout?.isTTY ?? false,
      fileExists: options.fileExists ?? existsSync,
    };
    const matched = agents.find((candidate) => evaluate(candidate.match, env, probes))?.name;
    const id = matched ?? override;
    if (!id) return undefined;
    return { id, rawId: override || id };
  } catch {
    return undefined;
  }
}
