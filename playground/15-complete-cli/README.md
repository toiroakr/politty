<!-- politty:command::start -->

# my-tool

Complete CLI tool example

**Usage**

```
my-tool [options] [command] <input>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `input`  | Input file  | Yes      |

**Options**

| Option              | Alias | Description           | Default  |
| ------------------- | ----- | --------------------- | -------- |
| `--output <OUTPUT>` | `-o`  | Output file           | -        |
| `--verbose`         | `-v`  | Enable verbose output | `false`  |
| `--format <FORMAT>` | `-f`  | Output format         | `"json"` |

**Commands**

| Command         | Description              |
| --------------- | ------------------------ |
| [`init`](#init) | Initialize a new project |

**Notes**

Supports subcommands, lifecycle hooks, and multiple output formats.

<!-- politty:command::end -->
<!-- politty:command:init:start -->

## init

Initialize a new project

**Usage**

```
my-tool init [options]
```

**Options**

| Option                  | Alias | Description     | Default     |
| ----------------------- | ----- | --------------- | ----------- |
| `--template <TEMPLATE>` | `-t`  | Template to use | `"default"` |
| `--name <NAME>`         | `-n`  | Project name    | -           |

<!-- politty:command:init:end -->
