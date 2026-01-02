<!-- politty:command::start -->

# resource

リソースを管理（discriminatedUnionの例）

## Usage

```
resource [options]
```

## Options

| Option                  | Alias | Description    | Default   |
| ----------------------- | ----- | -------------- | --------- |
| `--action <ACTION>`     | -     |                | -         |
| `--name <NAME>`         | -     | リソース名     | -         |
| `--template <TEMPLATE>` | -     | テンプレート   | -         |
| `--id <ID>`             | -     | リソースID     | -         |
| `--force`               | `-f`  | 確認なしで削除 | `false`   |
| `--format <FORMAT>`     | `-F`  | 出力形式       | `"table"` |
| `--limit <LIMIT>`       | `-n`  | 表示件数       | `10`      |

## Notes

--action の値によって使用可能なオプションが変わります。
create: --name, --template / delete: --id, --force / list: --format, --limit

<!-- politty:command::end -->
