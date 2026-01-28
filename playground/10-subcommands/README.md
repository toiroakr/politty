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

| Option              | Alias | Description        | Default  |
| ------------------- | ----- | ------------------ | -------- |
| `--output <OUTPUT>` | `-o`  | Output directory   | `"dist"` |
| `--minify`          | `-m`  | Minify output      | `false`  |
| `--watch`           | `-w`  | Watch file changes | `false`  |

<!-- politty:command:build:end -->
<!-- politty:command:init:start -->

## init

Initialize project

**Usage**

```
my-cli init [options]
```

**Options**

| Option                  | Alias | Description              | Default     |
| ----------------------- | ----- | ------------------------ | ----------- |
| `--template <TEMPLATE>` | `-t`  | Template name            | `"default"` |
| `--force`               | `-f`  | Overwrite existing files | `false`     |

<!-- politty:command:init:end -->
