<!-- politty:command::heading:start -->

# my-cli

<!-- politty:command::heading:end -->

<!-- politty:command::description:start -->

CLI example with subcommands

<!-- politty:command::description:end -->

<!-- politty:command::usage:start -->

**Usage**

```
my-cli [command]
```

<!-- politty:command::usage:end -->

<!-- politty:command::subcommands:start -->

**Commands**

| Command           | Description        |
| ----------------- | ------------------ |
| [`init`](#init)   | Initialize project |
| [`build`](#build) | Build project      |

<!-- politty:command::subcommands:end -->

<!-- politty:command:build:heading:start -->

## build

<!-- politty:command:build:heading:end -->

<!-- politty:command:build:description:start -->

Build project

<!-- politty:command:build:description:end -->

<!-- politty:command:build:usage:start -->

**Usage**

```
my-cli build [options]
```

<!-- politty:command:build:usage:end -->

<!-- politty:command:build:options:start -->

**Options**

| Option              | Alias | Description        | Required | Default  |
| ------------------- | ----- | ------------------ | -------- | -------- |
| `--output <OUTPUT>` | `-o`  | Output directory   | No       | `"dist"` |
| `--minify`          | `-m`  | Minify output      | No       | `false`  |
| `--watch`           | `-w`  | Watch file changes | No       | `false`  |

<!-- politty:command:build:options:end -->

<!-- politty:command:init:heading:start -->

## init

<!-- politty:command:init:heading:end -->

<!-- politty:command:init:description:start -->

Initialize project

<!-- politty:command:init:description:end -->

<!-- politty:command:init:usage:start -->

**Usage**

```
my-cli init [options]
```

<!-- politty:command:init:usage:end -->

<!-- politty:command:init:options:start -->

**Options**

| Option                  | Alias | Description              | Required | Default     |
| ----------------------- | ----- | ------------------------ | -------- | ----------- |
| `--template <TEMPLATE>` | `-t`  | Template name            | No       | `"default"` |
| `--force`               | `-f`  | Overwrite existing files | No       | `false`     |

<!-- politty:command:init:options:end -->
