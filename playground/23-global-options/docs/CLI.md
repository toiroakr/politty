<!-- politty:command::start -->

# My CLI

CLI with global options example

## Installation

```bash
npm install -g my-cli
```

> **Note**: This CLI requires Node.js 18 or higher.

**Usage**

```
my-cli [command]
```

<a id="global-options"></a>

**Global Options**

| Option              | Alias | Description                | Required | Default |
| ------------------- | ----- | -------------------------- | -------- | ------- |
| `--verbose`         | `-v`  | Enable verbose output      | No       | `false` |
| `--config <CONFIG>` | `-c`  | Path to configuration file | No       | -       |

**Commands**

| Command             | Description        |
| ------------------- | ------------------ |
| [`build`](#build)   | Build the project  |
| [`deploy`](#deploy) | Deploy the project |

<!-- politty:command::end -->
<!-- politty:command:build:start -->

## build

Build the project

**Usage**

```
my-cli build [options]
```

See [Global Options](#global-options) for options available to all commands.

**Options**

| Option              | Alias | Description         | Required | Default  |
| ------------------- | ----- | ------------------- | -------- | -------- |
| `--output <OUTPUT>` | `-o`  | Output directory    | No       | `"dist"` |
| `--minify`          | `-m`  | Minify output files | No       | `false`  |

<!-- politty:command:build:end -->
<!-- politty:command:deploy:start -->

## deploy

Deploy the project

**Usage**

```
my-cli deploy [options]
```

See [Global Options](#global-options) for options available to all commands.

**Options**

| Option              | Alias | Description                                 | Required | Default |
| ------------------- | ----- | ------------------------------------------- | -------- | ------- |
| `--target <TARGET>` | `-t`  | Deployment target (e.g., prod, staging)     | Yes      | -       |
| `--dry-run`         | `-n`  | Perform a dry run without actual deployment | No       | `false` |

<!-- politty:command:deploy:end -->

## License

MIT License
