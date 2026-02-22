<!-- politty:command::heading:start -->

# my-tool

<!-- politty:command::heading:end -->

<!-- politty:command::description:start -->

Complete CLI tool example

<!-- politty:command::description:end -->

<!-- politty:command::usage:start -->

**Usage**

```
my-tool [options] [command] <input>
```

<!-- politty:command::usage:end -->

<!-- politty:command::arguments:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `input`  | Input file  | Yes      |

<!-- politty:command::arguments:end -->

<!-- politty:command::options:start -->

**Options**

| Option              | Alias | Description           | Required | Default  |
| ------------------- | ----- | --------------------- | -------- | -------- |
| `--output <OUTPUT>` | `-o`  | Output file           | Yes      | -        |
| `--verbose`         | `-v`  | Enable verbose output | No       | `false`  |
| `--format <FORMAT>` | `-f`  | Output format         | No       | `"json"` |

<!-- politty:command::options:end -->

<!-- politty:command::subcommands:start -->

**Commands**

| Command         | Description              |
| --------------- | ------------------------ |
| [`init`](#init) | Initialize a new project |

<!-- politty:command::subcommands:end -->

<!-- politty:command::notes:start -->

**Notes**

Supports subcommands, lifecycle hooks, and multiple output formats.

<!-- politty:command::notes:end -->

<!-- politty:command:init:heading:start -->

## init

<!-- politty:command:init:heading:end -->

<!-- politty:command:init:description:start -->

Initialize a new project

<!-- politty:command:init:description:end -->

<!-- politty:command:init:usage:start -->

**Usage**

```
my-tool init [options]
```

<!-- politty:command:init:usage:end -->

<!-- politty:command:init:options:start -->

**Options**

| Option                  | Alias | Description     | Required | Default     |
| ----------------------- | ----- | --------------- | -------- | ----------- |
| `--template <TEMPLATE>` | `-t`  | Template to use | No       | `"default"` |
| `--name <NAME>`         | `-n`  | Project name    | No       | -           |

<!-- politty:command:init:options:end -->
