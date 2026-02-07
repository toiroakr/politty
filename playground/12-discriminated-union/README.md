<!-- politty:command::start -->

# resource

Manage resources (discriminatedUnion example)

**Usage**

```
resource [options]
```

**Options**

| Option                  | Alias | Description                 | Required | Default   |
| ----------------------- | ----- | --------------------------- | -------- | --------- |
| `--action <ACTION>`     | -     |                             | Yes      | -         |
| `--name <NAME>`         | -     | Resource name               | Yes      | -         |
| `--template <TEMPLATE>` | -     | Template                    | No       | -         |
| `--id <ID>`             | -     | Resource ID                 | Yes      | -         |
| `--force`               | `-f`  | Delete without confirmation | No       | `false`   |
| `--format <FORMAT>`     | `-F`  | Output format               | No       | `"table"` |
| `--limit <LIMIT>`       | `-n`  | Display limit               | No       | `10`      |

**Notes**

Available options vary depending on the value of `--action`.

- `create` — `--name`, `--template`
- `delete` — `--id`, `--force`
- `list` — `--format`, `--limit`

> [!NOTE]
> Only the options for the selected action are accepted.

<!-- politty:command::end -->
