# Zod Global Registry Augmentation

polittyは2つの方法でメタデータを管理できます：

## 方法1: 推奨 - 独自レジストリ（型安全）

デフォルトの方法です。`arg()`関数を使って独自のレジストリにメタデータを保存します。

```typescript
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";

const cmd = defineCommand({
  args: z.object({
    name: arg(z.string(), {
      alias: "n",
      description: "User name",
      positional: true,
    }),
    verbose: arg(z.boolean().default(false), {
      alias: "v",
      description: "Enable verbose mode",
    }),
  }),
  run: ({ args }) => {
    console.log(args.name, args.verbose);
  },
});

runMain(cmd);
```

**メリット:**

- Zodのグローバル型を汚染しない
- 他のZodユーザーとの競合がない
- 型安全

## 方法2: Zodグローバルレジストリ（オプション）

Zodの`_def`に直接メタデータを保存する方法です。`politty/augment`をimportすることで有効になります。

```typescript
import "politty/augment"; // この行を追加
import { z } from "zod";
import { defineCommand, runMain } from "politty";

// Zodスキーマの_defに直接argMetaを設定
const nameSchema = z.string();
(nameSchema as any)._def.argMeta = {
  alias: "n",
  description: "User name",
  positional: true,
};

const cmd = defineCommand({
  args: z.object({
    name: nameSchema,
    verbose: z.boolean().default(false),
  }),
  run: ({ args }) => {
    console.log(args.name, args.verbose);
  },
});

runMain(cmd);
```

**メリット:**

- Zodスキーマを直接拡張できる
- 既存のZodスキーマに後からメタデータを追加できる

**デメリット:**

- Zodのグローバル型定義を変更する
- 型安全性が下がる（型チェックが効かない）

## 優先順位

両方の方法が使われた場合、以下の優先順位でメタデータが解決されます：

1. `arg()`関数で登録されたメタデータ（最優先）
2. `_def.argMeta`に保存されたメタデータ
3. Zodの`.describe()`メソッドの説明文

```typescript
import "politty/augment";
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";

const nameSchema = z.string().describe("Zod description");
(nameSchema as any)._def.argMeta = {
  description: "_def description",
};

const cmd = defineCommand({
  args: z.object({
    // arg()が最優先される
    name: arg(nameSchema, {
      description: "arg() description", // これが使われる
    }),
  }),
  run: ({ args }) => {
    console.log(args.name);
  },
});

runMain(cmd);
```

## 推奨事項

- 新しいプロジェクト: **方法1（`arg()`関数）を使用**
- Zodグローバルレジストリが必要な場合のみ方法2を使用
- 両方を混在させる場合は優先順位を理解する
