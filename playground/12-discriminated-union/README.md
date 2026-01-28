<!-- politty:command::start -->

# resource

Manage resources (discriminatedUnion example)

**Usage**

```
resource [options]
```

**Options**

| Option                  | Alias | Description                 | Default   |
| ----------------------- | ----- | --------------------------- | --------- |
| `--action <ACTION>`     | -     |                             | -         |
| `--name <NAME>`         | -     | Resource name               | -         |
| `--template <TEMPLATE>` | -     | Template                    | -         |
| `--id <ID>`             | -     | Resource ID                 | -         |
| `--force`               | `-f`  | Delete without confirmation | `false`   |
| `--format <FORMAT>`     | `-F`  | Output format               | `"table"` |
| `--limit <LIMIT>`       | `-n`  | Display limit               | `10`      |

**Notes**

Available options vary depending on the value of --action.
create: --name, --template / delete: --id, --force / list: --format, --limit

<!-- politty:command::end -->
