<!-- politty:heading::start -->

# resource

<!-- politty:heading::end -->

<!-- politty:description::start -->

Manage resources (discriminatedUnion example)

<!-- politty:description::end -->

<!-- politty:usage::start -->

**Usage**

```
resource [options]
```

<!-- politty:usage::end -->

<!-- politty:options::start -->

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

<!-- politty:options::end -->

<!-- politty:notes::start -->

**Notes**

Available options vary depending on the value of `--action`.

| Action   | Options                |
| -------- | ---------------------- |
| `create` | `--name`, `--template` |
| `delete` | `--id`, `--force`      |
| `list`   | `--format`, `--limit`  |

> [!NOTE]
> Only the options for the selected action are accepted.

<!-- politty:notes::end -->
