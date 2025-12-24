# Playground

politty の動作確認用サンプルコードです。

## 実行方法

各ファイルは `pnpx tsx` で実行できます。

```bash
# 基本的な実行
pnpx tsx playground/01-hello-world.ts

# 引数付きで実行
pnpx tsx playground/02-greet.ts World -g "Hi" -l

# ヘルプを表示
pnpx tsx playground/10-subcommands.ts --help
```

## ファイル一覧

### 基本編

| ファイル                | 内容                                    |
| ----------------------- | --------------------------------------- |
| `01-hello-world.ts`     | 最小構成のコマンド                      |
| `02-greet.ts`           | positional 引数とオプション             |
| `03-array-args.ts`      | 配列引数（`--file a.txt --file b.txt`） |
| `04-type-coercion.ts`   | 型変換とバリデーション（`z.coerce`）    |
| `05-lifecycle-hooks.ts` | setup/run/cleanup フック                |

### Positional 引数編

| ファイル                | 内容                                   |
| ----------------------- | -------------------------------------- |
| `06-cp-command.ts`      | cp コマンド風（複数 positional）       |
| `07-gcc-command.ts`     | gcc コマンド風（配列 positional）      |
| `08-cat-command.ts`     | cat コマンド風（配列 positional のみ） |
| `09-convert-command.ts` | オプション positional 引数             |

### 応用編

| ファイル                        | 内容                                             |
| ------------------------------- | ------------------------------------------------ |
| `10-subcommands.ts`             | サブコマンド                                     |
| `11-nested-subcommands.ts`      | ネストしたサブコマンド                           |
| `12-discriminated-union.ts`     | discriminatedUnion（相互排他オプション）         |
| `13-intersection.ts`            | intersection（共通オプションの再利用）           |
| `14-transform-refine.ts`        | transform/refine（変換とカスタムバリデーション） |
| `15-complete-cli.ts`            | 完全な CLI の例                                  |
| `16-show-subcommand-options.ts` | サブコマンドのオプションをまとめて表示           |

## 例

### 02-greet.ts

```bash
# 基本的な使用
pnpx tsx playground/02-greet.ts World
# 出力: Hello, World!

# オプション付き
pnpx tsx playground/02-greet.ts World -g "Hi" -l
# 出力: HI, WORLD!

# ヘルプ表示
pnpx tsx playground/02-greet.ts --help
```

### 10-subcommands.ts

```bash
# ヘルプ表示
pnpx tsx playground/10-subcommands.ts --help

# initサブコマンド
pnpx tsx playground/10-subcommands.ts init -t react

# buildサブコマンド
pnpx tsx playground/10-subcommands.ts build -o out -m
```

### 12-discriminated-union.ts

```bash
# createアクション
pnpx tsx playground/12-discriminated-union.ts --action create --name my-resource

# deleteアクション
pnpx tsx playground/12-discriminated-union.ts --action delete --id 123 -f

# listアクション
pnpx tsx playground/12-discriminated-union.ts --action list -f json
```

### 16-show-subcommand-options.ts

```bash
# 基本ヘルプ
pnpx tsx playground/16-show-subcommand-options.ts --help

# 詳細ヘルプ（サブコマンドのオプションも表示）
pnpx tsx playground/16-show-subcommand-options.ts --help-all  # または -H

# サブコマンドのヘルプ
pnpx tsx playground/16-show-subcommand-options.ts config list --help

# --help-all の出力例:
# Commands:
#   config                      設定を管理
#   config get                  設定値を取得
#   config set                  設定値を設定
#   config list                 全ての設定を一覧表示
#     -f, --format <FORMAT>     出力形式 (default: "table")
#     -g, --global              グローバル設定を表示 (default: false)
```
