import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCommand } from "../index.js";
import { renderExamplesDefault } from "./default-renderers.js";
import { executeExamples } from "./example-executor.js";

describe("example-executor", () => {
  describe("executeExamples", () => {
    it("captures stdout correctly", async () => {
      const command = defineCommand({
        name: "test",
        args: z.object({}),
        run: () => {
          console.log("hello");
          console.log("world");
        },
      });

      const results = await executeExamples([{ cmd: "", desc: "Test stdout" }], {}, command);

      expect(results).toHaveLength(1);
      expect(results[0]?.stdout).toBe("hello\nworld");
      expect(results[0]?.stderr).toBe("");
      expect(results[0]?.success).toBe(true);
    });

    it("captures stderr correctly", async () => {
      const command = defineCommand({
        name: "test",
        args: z.object({}),
        run: () => {
          console.error("error1");
          console.warn("warning1");
        },
      });

      const results = await executeExamples([{ cmd: "", desc: "Test stderr" }], {}, command);

      expect(results).toHaveLength(1);
      expect(results[0]?.stdout).toBe("");
      expect(results[0]?.stderr).toBe("error1\nwarning1");
      expect(results[0]?.success).toBe(true);
    });

    it("preserves stdout/stderr output order", async () => {
      const command = defineCommand({
        name: "test",
        args: z.object({}),
        run: () => {
          console.log("stdout1");
          console.error("stderr1");
          console.log("stdout2");
          console.warn("warn1");
          console.log("stdout3");
        },
      });

      const results = await executeExamples([{ cmd: "", desc: "Test output order" }], {}, command);

      expect(results).toHaveLength(1);
      const result = results[0]!;

      // output field should preserve the interleaved order
      expect(result.output).toHaveLength(5);
      expect(result.output[0]).toEqual({ stream: "stdout", text: "stdout1" });
      expect(result.output[1]).toEqual({ stream: "stderr", text: "stderr1" });
      expect(result.output[2]).toEqual({ stream: "stdout", text: "stdout2" });
      expect(result.output[3]).toEqual({ stream: "stderr", text: "warn1" });
      expect(result.output[4]).toEqual({ stream: "stdout", text: "stdout3" });

      // stdout/stderr fields should still contain aggregated output
      expect(result.stdout).toBe("stdout1\nstdout2\nstdout3");
      expect(result.stderr).toBe("stderr1\nwarn1");
    });

    it("preserves output order with multiple examples", async () => {
      const command = defineCommand({
        name: "test",
        args: z.object({}),
        subCommands: {
          first: defineCommand({
            name: "first",
            args: z.object({}),
            run: () => {
              console.log("first-out");
              console.error("first-err");
            },
          }),
          second: defineCommand({
            name: "second",
            args: z.object({}),
            run: () => {
              console.error("second-err");
              console.log("second-out");
            },
          }),
        },
      });

      const results = await executeExamples(
        [
          { cmd: "first", desc: "First command" },
          { cmd: "second", desc: "Second command" },
        ],
        {},
        command,
      );

      expect(results).toHaveLength(2);

      // First example
      expect(results[0]?.output).toEqual([
        { stream: "stdout", text: "first-out" },
        { stream: "stderr", text: "first-err" },
      ]);

      // Second example
      expect(results[1]?.output).toEqual([
        { stream: "stderr", text: "second-err" },
        { stream: "stdout", text: "second-out" },
      ]);
    });

    it("includes error in output order when command fails", async () => {
      const command = defineCommand({
        name: "test",
        args: z.object({}),
        run: () => {
          console.log("before error");
          throw new Error("command failed");
        },
      });

      const results = await executeExamples([{ cmd: "", desc: "Test error" }], {}, command);

      expect(results).toHaveLength(1);
      const result = results[0]!;

      expect(result.success).toBe(false);
      expect(result.output).toHaveLength(2);
      expect(result.output[0]).toEqual({ stream: "stdout", text: "before error" });
      expect(result.output[1]).toEqual({ stream: "stderr", text: "command failed" });
    });

    it("calls mock and cleanup functions", async () => {
      let mockCalled = false;
      let cleanupCalled = false;

      const command = defineCommand({
        name: "test",
        args: z.object({}),
        run: () => {
          console.log("executed");
        },
      });

      await executeExamples(
        [{ cmd: "", desc: "Test mock" }],
        {
          mock: () => {
            mockCalled = true;
          },
          cleanup: () => {
            cleanupCalled = true;
          },
        },
        command,
      );

      expect(mockCalled).toBe(true);
      expect(cleanupCalled).toBe(true);
    });
  });

  describe("renderExamplesDefault with output order", () => {
    it("renders output in original order when preserveOrder is false (default)", () => {
      const examples = [{ cmd: "test", desc: "Test example" }];
      const results = [
        {
          cmd: "test",
          desc: "Test example",
          stdout: "out1\nout2",
          stderr: "err1",
          output: [
            { stream: "stdout" as const, text: "out1" },
            { stream: "stderr" as const, text: "err1" },
            { stream: "stdout" as const, text: "out2" },
          ],
          success: true,
        },
      ];

      const rendered = renderExamplesDefault(examples, results);

      // Without preserveOrder, stdout comes first, then stderr
      expect(rendered).toContain("out1\nout2");
      expect(rendered).toContain("[stderr] err1");
      expect(rendered.indexOf("out2")).toBeLessThan(rendered.indexOf("[stderr] err1"));
    });

    it("renders output in interleaved order when preserveOrder is true", () => {
      const examples = [{ cmd: "test", desc: "Test example" }];
      const results = [
        {
          cmd: "test",
          desc: "Test example",
          stdout: "out1\nout2",
          stderr: "err1",
          output: [
            { stream: "stdout" as const, text: "out1" },
            { stream: "stderr" as const, text: "err1" },
            { stream: "stdout" as const, text: "out2" },
          ],
          success: true,
        },
      ];

      const rendered = renderExamplesDefault(examples, results, { preserveOrder: true });

      // With preserveOrder, output appears in original order
      const lines = rendered.split("\n");
      const outputLines = lines.filter(
        (line) => line === "out1" || line === "out2" || line.includes("[stderr]"),
      );

      expect(outputLines).toEqual(["out1", "[stderr] err1", "out2"]);
    });

    it("handles empty output array gracefully", () => {
      const examples = [{ cmd: "test", desc: "Test example" }];
      const results = [
        {
          cmd: "test",
          desc: "Test example",
          stdout: "",
          stderr: "",
          output: [],
          success: true,
        },
      ];

      const rendered = renderExamplesDefault(examples, results, { preserveOrder: true });

      expect(rendered).toContain("$ test");
      expect(rendered).not.toContain("[stderr]");
    });

    it("falls back to stdout/stderr when output is empty with preserveOrder", () => {
      const examples = [{ cmd: "test", desc: "Test example" }];
      const results = [
        {
          cmd: "test",
          desc: "Test example",
          stdout: "fallback output",
          stderr: "fallback error",
          output: [],
          success: true,
        },
      ];

      const rendered = renderExamplesDefault(examples, results, { preserveOrder: true });

      // Should fall back to stdout/stderr when output array is empty
      expect(rendered).toContain("fallback output");
      expect(rendered).toContain("[stderr] fallback error");
    });
  });
});
