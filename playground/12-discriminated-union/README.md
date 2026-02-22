<!-- politty:command::heading:start -->

# resource

<!-- politty:command::heading:end -->

<!-- politty:command::description:start -->

Manage resources (discriminatedUnion example)

<!-- politty:command::description:end -->

<!-- politty:command::usage:start -->

**Usage**

```
resource [options]
```

<!-- politty:command::usage:end -->

<!-- politty:command::options:start -->

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

<!-- politty:command::options:end -->

<!-- politty:command::notes:start -->

**Notes**

Available options vary depending on the value of `--action`.

| Action   | Options                |
| -------- | ---------------------- |
| `create` | `--name`, `--template` |
| `delete` | `--id`, `--force`      |
| `list`   | `--format`, `--limit`  |

> [!NOTE]
> Only the options for the selected action are accepted.

<!-- politty:command::notes:end -->
