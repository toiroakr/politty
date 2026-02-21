<!-- politty:command::heading:start -->

# my-app

<!-- politty:command::heading:end -->

<!-- politty:command::description:start -->

CLI demonstrating lazy loading subcommands with dynamic imports

<!-- politty:command::description:end -->

<!-- politty:command::usage:start -->

**Usage**

```
my-app [command]
```

<!-- politty:command::usage:end -->

<!-- politty:command::subcommands:start -->

**Commands**

| Command                   | Description                             |
| ------------------------- | --------------------------------------- |
| [`status`](#status)       | Show current status (eagerly loaded)    |
| [`heavy`](#heavy)         | A heavy command that is lazily loaded   |
| [`analytics`](#analytics) | Analyze project metrics (lazily loaded) |

<!-- politty:command::subcommands:end -->

<!-- politty:command:analytics:heading:start -->

## analytics

<!-- politty:command:analytics:heading:end -->

<!-- politty:command:analytics:description:start -->

Analyze project metrics (lazily loaded)

<!-- politty:command:analytics:description:end -->

<!-- politty:command:analytics:usage:start -->

**Usage**

```
my-app analytics [options]
```

<!-- politty:command:analytics:usage:end -->

<!-- politty:command:analytics:options:start -->

**Options**

| Option              | Alias | Description       | Required | Default   |
| ------------------- | ----- | ----------------- | -------- | --------- |
| `--metric <METRIC>` | `-m`  | Metric to analyze | No       | `"lines"` |
| `--format <FORMAT>` | `-f`  | Output format     | No       | `"text"`  |

<!-- politty:command:analytics:options:end -->

<!-- politty:command:heavy:heading:start -->

## heavy

<!-- politty:command:heavy:heading:end -->

<!-- politty:command:heavy:description:start -->

A heavy command that is lazily loaded

<!-- politty:command:heavy:description:end -->

<!-- politty:command:heavy:usage:start -->

**Usage**

```
my-app heavy [options]
```

<!-- politty:command:heavy:usage:end -->

<!-- politty:command:heavy:options:start -->

**Options**

| Option                      | Alias | Description          | Required | Default |
| --------------------------- | ----- | -------------------- | -------- | ------- |
| `--iterations <ITERATIONS>` | `-n`  | Number of iterations | No       | `1000`  |
| `--verbose`                 | `-v`  | Verbose output       | No       | `false` |

<!-- politty:command:heavy:options:end -->

<!-- politty:command:status:heading:start -->

## status

<!-- politty:command:status:heading:end -->

<!-- politty:command:status:description:start -->

Show current status (eagerly loaded)

<!-- politty:command:status:description:end -->

<!-- politty:command:status:usage:start -->

**Usage**

```
my-app status [options]
```

<!-- politty:command:status:usage:end -->

<!-- politty:command:status:options:start -->

**Options**

| Option      | Alias | Description          | Required | Default |
| ----------- | ----- | -------------------- | -------- | ------- |
| `--verbose` | `-v`  | Show detailed status | No       | `false` |

<!-- politty:command:status:options:end -->
