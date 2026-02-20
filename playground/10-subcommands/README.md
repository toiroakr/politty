<!-- politty:heading::start -->

# my-cli

<!-- politty:heading::end -->

<!-- politty:description::start -->

CLI example with subcommands

<!-- politty:description::end -->

<!-- politty:usage::start -->

**Usage**

```
my-cli [command]
```

<!-- politty:usage::end -->

<!-- politty:subcommands::start -->

**Commands**

| Command           | Description        |
| ----------------- | ------------------ |
| [`init`](#init)   | Initialize project |
| [`build`](#build) | Build project      |

<!-- politty:subcommands::end -->

<!-- politty:heading:build:start -->

## build

<!-- politty:heading:build:end -->

<!-- politty:description:build:start -->

Build project

<!-- politty:description:build:end -->

<!-- politty:usage:build:start -->

**Usage**

```
my-cli build [options]
```

<!-- politty:usage:build:end -->

<!-- politty:options:build:start -->

**Options**

| Option              | Alias | Description        | Required | Default  |
| ------------------- | ----- | ------------------ | -------- | -------- |
| `--output <OUTPUT>` | `-o`  | Output directory   | No       | `"dist"` |
| `--minify`          | `-m`  | Minify output      | No       | `false`  |
| `--watch`           | `-w`  | Watch file changes | No       | `false`  |

<!-- politty:options:build:end -->

<!-- politty:heading:init:start -->

## init

<!-- politty:heading:init:end -->

<!-- politty:description:init:start -->

Initialize project

<!-- politty:description:init:end -->

<!-- politty:usage:init:start -->

**Usage**

```
my-cli init [options]
```

<!-- politty:usage:init:end -->

<!-- politty:options:init:start -->

**Options**

| Option                  | Alias | Description              | Required | Default     |
| ----------------------- | ----- | ------------------------ | -------- | ----------- |
| `--template <TEMPLATE>` | `-t`  | Template name            | No       | `"default"` |
| `--force`               | `-f`  | Overwrite existing files | No       | `false`     |

<!-- politty:options:init:end -->
