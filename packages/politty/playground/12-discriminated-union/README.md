<!-- politty:command::start -->

# resource

Manage resources (discriminatedUnion example)

**Usage**

```
resource [options]
```

**Options**

| Option                            | Alias | Description | Required | Default |
| --------------------------------- | ----- | ----------- | -------- | ------- |
| `--action <create\|delete\|list>` | -     |             | Yes      | -       |

**When `action` = `create`:** Create a new resource

| Option                  | Alias | Description   | Required | Default |
| ----------------------- | ----- | ------------- | -------- | ------- |
| `--name <NAME>`         | -     | Resource name | Yes      | -       |
| `--template <TEMPLATE>` | -     | Template      | No       | -       |

**When `action` = `delete`:** Delete an existing resource

| Option      | Alias | Description                 | Required | Default |
| ----------- | ----- | --------------------------- | -------- | ------- |
| `--id <ID>` | -     | Resource ID                 | Yes      | -       |
| `--force`   | `-f`  | Delete without confirmation | No       | `false` |

**When `action` = `list`:**

| Option              | Alias | Description   | Required | Default   |
| ------------------- | ----- | ------------- | -------- | --------- |
| `--format <FORMAT>` | `-F`  | Output format | No       | `"table"` |
| `--limit <LIMIT>`   | `-n`  | Display limit | No       | `10`      |

**Notes**

Available options vary depending on the value of `--action`.

| Action   | Options                |
| -------- | ---------------------- |
| `create` | `--name`, `--template` |
| `delete` | `--id`, `--force`      |
| `list`   | `--format`, `--limit`  |

> [!NOTE]
> Only the options for the selected action are accepted.

<!-- politty:command::end -->
