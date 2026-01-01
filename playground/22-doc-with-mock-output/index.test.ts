import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import type { SimpleRenderContext } from "../../src/docs/types.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { command } from "./index.js";

describe("22-doc-with-mock-output", () => {
  let consoleSpy: ConsoleSpy;

  beforeEach(() => {
    consoleSpy = spyOnConsoleLog();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("displays user info in text format", async () => {
    const result = await runCommand(command, ["Alice"]);

    expect(result.success).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith("User: Alice");
    expect(consoleSpy).toHaveBeenCalledWith("Role: developer");
    expect(consoleSpy).toHaveBeenCalledWith("Created: 2024-01-15");
  });

  it("displays user info in JSON format", async () => {
    const result = await runCommand(command, ["Bob", "--format", "json"]);

    expect(result.success).toBe(true);
    const logs = consoleSpy.getLogs();
    const output = JSON.parse(logs.join(""));
    expect(output).toEqual({
      name: "Bob",
      createdAt: "2024-01-15",
      role: "developer",
    });
  });

  it("displays verbose user info", async () => {
    const result = await runCommand(command, ["Charlie", "--verbose"]);

    expect(result.success).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith("Email: charlie@example.com");
    expect(consoleSpy).toHaveBeenCalledWith("Last Login: 2024-03-20");
  });
});

/**
 * ドキュメント生成テスト（モックを使った出力例の追加）
 *
 * このテストでは、コマンドの実行結果をキャプチャして
 * ドキュメントのExamplesセクションとして追加します。
 */
describe("22-doc-with-mock-output documentation", () => {
  it("generates documentation with mock output examples", async () => {
    // モックを使って出力をキャプチャ
    const capturedOutputs = await captureCommandOutputs();

    // カスタムレンダラーで出力例を追加
    await assertDocMatch({
      command,
      files: { "playground/22-doc-with-mock-output/README.md": [""] },
      format: {
        renderFooter: (context: SimpleRenderContext) => {
          return generateExamplesSection(context.heading, capturedOutputs);
        },
      },
    });
  });
});

/**
 * コマンドの出力をキャプチャするヘルパー関数
 * 各コマンド実行ごとに独立したモックを使用
 */
async function captureCommandOutputs(): Promise<CapturedOutput[]> {
  const outputs: CapturedOutput[] = [];

  // 基本的な使用例
  {
    // console.log をサイレントモックに置き換え
    const logs: string[] = [];
    const mockLog = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(
        args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" "),
      );
    });

    await runCommand(command, ["Alice"]);

    outputs.push({
      title: "基本的な使用例",
      command: "user-info Alice",
      output: logs.join("\n"),
    });

    mockLog.mockRestore();
  }

  // JSON形式での出力
  {
    const logs: string[] = [];
    const mockLog = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(
        args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" "),
      );
    });

    await runCommand(command, ["Bob", "-f", "json"]);

    outputs.push({
      title: "JSON形式での出力",
      command: "user-info Bob -f json",
      output: logs.join("\n"),
    });

    mockLog.mockRestore();
  }

  // 詳細情報の表示
  {
    const logs: string[] = [];
    const mockLog = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(
        args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" "),
      );
    });

    await runCommand(command, ["Charlie", "--verbose"]);

    outputs.push({
      title: "詳細情報の表示",
      command: "user-info Charlie --verbose",
      output: logs.join("\n"),
    });

    mockLog.mockRestore();
  }

  return outputs;
}

interface CapturedOutput {
  title: string;
  command: string;
  output: string;
}

/**
 * キャプチャした出力からExamplesセクションを生成
 */
function generateExamplesSection(heading: string, outputs: CapturedOutput[]): string {
  const lines: string[] = [];
  lines.push(`${heading} Examples`);
  lines.push("");

  for (const { title, command, output } of outputs) {
    lines.push(`### ${title}`);
    lines.push("");
    lines.push("```bash");
    lines.push(`$ ${command}`);
    lines.push(output);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
