# politty

**politty** は Zod v4 を活用した軽量で型安全な CLI フレームワークです。

## 特徴

- **Zod v4 ネイティブ対応**: スキーマ定義と引数バリデーションを統一
- **完全な型推論**: `args` の型が自動的に推論される
- **柔軟な引数定義**: positional引数、オプション、エイリアス、配列をサポート
- **サブコマンド対応**: 遅延ロードにも対応したサブコマンドシステム
- **ライフサイクルフック**: `setup` → `run` → `cleanup` の実行順序を保証
- **自動ヘルプ生成**: スキーマから自動的にヘルプテキストを生成
- **discriminatedUnion対応**: 複雑な相互排他オプションも表現可能

## クイックスタート

```typescript
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";

const command = defineCommand({
  name: "greet",
  version: "1.0.0",
  description: "挨拶を表示するCLIツール",
  args: z.object({
    name: arg(z.string(), {
      positional: true,
      description: "挨拶する相手の名前"
    }),
    greeting: arg(z.string().default("Hello"), {
      alias: "g",
      description: "挨拶のフレーズ"
    }),
    loud: arg(z.boolean().default(false), {
      alias: "l",
      description: "大文字で出力"
    }),
  }),
  run: ({ args }) => {
    let message = `${args.greeting}, ${args.name}!`;
    if (args.loud) {
      message = message.toUpperCase();
    }
    console.log(message);
  },
});

runMain(command);
```

### 実行例

```bash
# 基本的な使用
$ greet World
Hello, World!

# オプション付き
$ greet World -g "Hi" -l
HI, WORLD!

# ヘルプ表示
$ greet --help
greet v1.0.0
挨拶を表示するCLIツール

Usage: greet [options] <name>

Options:
  -h, --help                  Show help
  --version                   Show version
  -g, --greeting <GREETING>   挨拶のフレーズ (default: "Hello")
  -l, --loud                  大文字で出力 (default: false)
```

## インストール

```bash
npm install politty zod
# または
pnpm add politty zod
```

## ドキュメント

- [はじめに](./getting-started.md) - インストールと基本的な使い方
- [APIリファレンス](./api-reference.md) - 関数・型の詳細
- [Positional引数](./positional-arguments.md) - positional引数の詳細なルール
- [応用例](./advanced-usage.md) - discriminatedUnion、サブコマンドなど

## 設計思想

politty は以下の原則に基づいて設計されています：

1. **Zodファースト**: Zod のスキーマをそのまま使用し、追加の学習コストを最小化
2. **型安全性**: TypeScript の型推論を最大限活用
3. **シンプルさ**: 最小限のAPIで最大限の機能を提供
4. **拡張性**: 複雑なユースケースにも対応可能な柔軟性

## ライセンス

MIT
