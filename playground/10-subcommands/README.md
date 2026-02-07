<!-- politty:command::start -->

# my-cli

CLI example with subcommands

**Usage**

```
my-cli [command]
```

**Commands**

| Command           | Description        |
| ----------------- | ------------------ |
| [`init`](#init)   | Initialize project |
| [`build`](#build) | Build project      |

<!-- politty:command::end -->
<!-- politty:command:build:start -->

## build

Build project

**Usage**

```
my-cli build [options]
```

**Options**

| Option              | Alias | Description        | Required | Default  |
| ------------------- | ----- | ------------------ | -------- | -------- |
| `--output <OUTPUT>` | `-o`  | Output directory   | No       | `"dist"` |
| `--minify`          | `-m`  | Minify output      | No       | `false`  |
| `--watch`           | `-w`  | Watch file changes | No       | `false`  |

<!-- politty:command:build:end -->
<!-- politty:command:init:start -->

## init

Initialize project

**Usage**

```
my-cli init [options]
```

**Options**

| Option                  | Alias | Description              | Required | Default     |
| ----------------------- | ----- | ------------------------ | -------- | ----------- |
| `--template <TEMPLATE>` | `-t`  | Template name            | No       | `"default"` |
| `--force`               | `-f`  | Overwrite existing files | No       | `false`     |

<!-- politty:command:init:end -->
