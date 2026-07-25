import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
}

interface WorkflowFile {
  name: string;
  jobs: Record<string, { steps: WorkflowStep[] }>;
}

const workflow = parseYaml(
  readFileSync(resolve(rootDir, ".github/workflows/workflow-lint.yml"), "utf8"),
) as WorkflowFile;

const steps = workflow.jobs["workflow-lint"]!.steps;

function findStepByName(name: string): WorkflowStep {
  const step = steps.find((s) => s.name === name);
  if (!step) throw new Error(`step "${name}" not found`);
  return step;
}

describe("workflow-lint.yml", () => {
  it("parses as valid YAML", () => {
    expect(workflow.name).toBe("Workflow Lint");
  });

  it("keeps the full expected step sequence: checkout, aqua-installer, ghalint, pinact, karinto", () => {
    const identifiers = steps.map((s) => s.uses?.split("@")[0] ?? s.name);
    expect(identifiers).toEqual([
      "actions/checkout",
      "aquaproj/aqua-installer",
      "ghalint",
      "pinact",
      "karinto",
    ]);
  });

  it("adds the karinto step immediately after the pinact step", () => {
    const names = steps.map((s) => s.name);
    const pinactIndex = names.indexOf("pinact");
    const karintoIndex = names.indexOf("karinto");
    expect(pinactIndex).toBeGreaterThanOrEqual(0);
    expect(karintoIndex).toBe(pinactIndex + 1);
  });

  describe("karinto step", () => {
    const script = findStepByName("karinto").run ?? "";

    it("has a non-empty run script", () => {
      expect(script.length).toBeGreaterThan(0);
    });

    it("enables strict shell error handling before doing anything else", () => {
      expect(script.trimStart().startsWith("set -euo pipefail")).toBe(true);
    });

    it("initializes an exit code accumulator", () => {
      expect(script).toContain("exit_code=0");
    });

    it("iterates workflow files with a NUL-delimited find/read loop", () => {
      expect(script).toContain("find .github/workflows -type f");
      expect(script).toContain("-name '*.yml'");
      expect(script).toContain("-name '*.yaml'");
      expect(script).toContain("-print0");
      expect(script).toContain("while IFS= read -r -d '' f; do");
    });

    it("posts each file's content and path to the karinto lint endpoint", () => {
      expect(script).toContain("curl -sS -X POST");
      expect(script).toContain('--data-urlencode "content@${f}"');
      expect(script).toContain('--data-urlencode "path=${f}"');
      expect(script).toContain("https://karinto.toiroakr.workers.dev");
    });

    it("logs the raw response inside a collapsible group", () => {
      expect(script).toContain('echo "::group::karinto: ${f}"');
      expect(script).toContain('echo "${resp}" | jq .');
      expect(script).toContain('echo "::endgroup::"');
    });

    it("counts error-severity diagnostics with jq", () => {
      expect(script).toContain('[.result.diagnostics[]? | select(.severity == "error")] | length');
    });

    it("emits a GitHub Actions error annotation and marks the job failed when errors are found", () => {
      expect(script).toContain('if [ "${errors}" -gt 0 ]; then');
      expect(script).toContain(
        'echo "::error file=${f}::karinto found ${errors} error-severity diagnostic(s)"',
      );
      expect(script).toContain("exit_code=1");
    });

    it("exits with the accumulated exit code after processing all files", () => {
      expect(script.trimEnd().endsWith('exit "${exit_code}"')).toBe(true);
    });

    it("does not exit early on the first offending file, so every file gets linted", () => {
      const ifBlockMatch = script.match(/if \[ "\$\{errors\}" -gt 0 \]; then([\s\S]*?)fi/);
      expect(ifBlockMatch).not.toBeNull();
      const ifBlockBody = ifBlockMatch?.[1] ?? "";
      expect(ifBlockBody).not.toMatch(/\bexit\b/);
    });
  });
});