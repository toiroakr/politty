<!-- politty:command::start -->

# db-query

データベースクエリの実行（ライフサイクルフックのデモ）

## Usage

```
db-query [options]
```

## Options

| Option                  | Alias | Description            | Default |
| ----------------------- | ----- | ---------------------- | ------- |
| `--database <DATABASE>` | `-d`  | データベース接続文字列 | -       |
| `--query <QUERY>`       | `-q`  | SQLクエリ              | -       |
| `--simulate_error`      | `-e`  | エラーをシミュレート   | `false` |

## Notes

このコマンドは setup → run → cleanup の実行順序を示します。
--simulate-error フラグを使用すると、エラー発生時でも cleanup が呼ばれることを確認できます。

<!-- politty:command::end -->
