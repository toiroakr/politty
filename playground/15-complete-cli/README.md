<!-- politty:heading::start -->

# my-tool

<!-- politty:heading::end -->

<!-- politty:description::start -->

Complete CLI tool example

<!-- politty:description::end -->

<!-- politty:usage::start -->

**Usage**

```
my-tool [options] [command] <input>
```

<!-- politty:usage::end -->

<!-- politty:arguments::start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `input`  | Input file  | Yes      |

<!-- politty:arguments::end -->

<!-- politty:options::start -->

**Options**

| Option              | Alias | Description           | Required | Default  |
| ------------------- | ----- | --------------------- | -------- | -------- |
| `--output <OUTPUT>` | `-o`  | Output file           | Yes      | -        |
| `--verbose`         | `-v`  | Enable verbose output | No       | `false`  |
| `--format <FORMAT>` | `-f`  | Output format         | No       | `"json"` |

<!-- politty:options::end -->

<!-- politty:subcommands::start -->

**Commands**

| Command         | Description              |
| --------------- | ------------------------ |
| [`init`](#init) | Initialize a new project |

<!-- politty:subcommands::end -->

<!-- politty:notes::start -->

**Notes**

Supports subcommands, lifecycle hooks, and multiple output formats.

<!-- politty:notes::end -->

<!-- politty:heading:init:start -->

## init

<!-- politty:heading:init:end -->

<!-- politty:description:init:start -->

Initialize a new project

<!-- politty:description:init:end -->

<!-- politty:usage:init:start -->

**Usage**

```
my-tool init [options]
```

<!-- politty:usage:init:end -->

<!-- politty:options:init:start -->

**Options**

| Option                  | Alias | Description     | Required | Default     |
| ----------------------- | ----- | --------------- | -------- | ----------- |
| `--template <TEMPLATE>` | `-t`  | Template to use | No       | `"default"` |
| `--name <NAME>`         | `-n`  | Project name    | No       | -           |

<!-- politty:options:init:end -->
