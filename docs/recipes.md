# Recipes

## テスト

politty はテストのしやすさを考慮して設計されています。`runMain` に `argv` 配列を直接渡すことで、コマンドライン実行をシミュレートできます。

テストランナーには **Vitest** を推奨しますが、何でも構いません。

```typescript
import { describe, it, expect, vi } from "vitest";
import { defineCommand, runMain, arg } from "politty";
import { z } from "zod";

describe("my-cli", () => {
  it("引数が正しくパースされること", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => logs.push(msg));

    const command = defineCommand({
      args: z.object({
        name: arg(z.string(), { positional: true })
      }),
      run: ({ args }) => console.log(`Hello ${args.name}`)
    });

    // 引数を直接渡す
    const result = await runMain(command, { argv: ["World"] });

    expect(result.exitCode).toBe(0);
    expect(logs).toContain("Hello World");
  });
});
```

### バリデーションエラーのテスト

無効な引数が渡されたときに、期待される終了コード（通常は 1）が返ることを確認できます。

```typescript
it("バリデーションに失敗すること", async () => {
  // エラー出力を抑制
  vi.spyOn(console, "error").mockImplementation(() => {});

  const command = defineCommand({
    args: z.object({ age: arg(z.number()) })
  });

  const result = await runMain(command, { argv: ["--age", "not-a-number"] });

  expect(result.exitCode).toBe(1);
});
```

## ランタイム設定

### シグナルハンドリング (Ctrl+C)

終了シグナル（SIGINT, SIGTERM）を適切に処理して `cleanup` フックを実行させるには、`handleSignals` を有効にします。

```typescript
runMain(command, {
  handleSignals: true
});
```

これにより、ユーザーがプロセスを中断した場合でも `cleanup` が確実に呼ばれます。

### デバッグモード

デバッグモードを有効にすると、エラー発生時にエラーメッセージだけでなく完全なスタックトレースが表示されます。

```typescript
runMain(command, {
  debug: true
});
```

## エラーハンドリング

`run` 内でスローされたエラーは `runMain` によって捕捉され、stderr に出力されます。`cleanup` フックは `error` オブジェクトと共に実行されます。

```typescript
const command = defineCommand({
  run: () => {
    throw new Error("何かが壊れました！");
  },
  cleanup: ({ error }) => {
    if (error) {
      // 緊急のクリーンアップやロギングを行う
    }
  }
});
```
