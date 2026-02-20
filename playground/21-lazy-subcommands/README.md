<!-- politty:heading::start -->

# my-app

<!-- politty:heading::end -->

<!-- politty:description::start -->

CLI demonstrating lazy loading subcommands with dynamic imports

<!-- politty:description::end -->

<!-- politty:usage::start -->

**Usage**

```
my-app [command]
```

<!-- politty:usage::end -->

<!-- politty:subcommands::start -->

**Commands**

| Command                   | Description                             |
| ------------------------- | --------------------------------------- |
| [`status`](#status)       | Show current status (eagerly loaded)    |
| [`heavy`](#heavy)         | A heavy command that is lazily loaded   |
| [`analytics`](#analytics) | Analyze project metrics (lazily loaded) |

<!-- politty:subcommands::end -->

<!-- politty:heading:analytics:start -->

## analytics

<!-- politty:heading:analytics:end -->

<!-- politty:description:analytics:start -->

Analyze project metrics (lazily loaded)

<!-- politty:description:analytics:end -->

<!-- politty:usage:analytics:start -->

**Usage**

```
my-app analytics [options]
```

<!-- politty:usage:analytics:end -->

<!-- politty:options:analytics:start -->

**Options**

| Option              | Alias | Description       | Required | Default   |
| ------------------- | ----- | ----------------- | -------- | --------- |
| `--metric <METRIC>` | `-m`  | Metric to analyze | No       | `"lines"` |
| `--format <FORMAT>` | `-f`  | Output format     | No       | `"text"`  |

<!-- politty:options:analytics:end -->

<!-- politty:heading:heavy:start -->

## heavy

<!-- politty:heading:heavy:end -->

<!-- politty:description:heavy:start -->

A heavy command that is lazily loaded

<!-- politty:description:heavy:end -->

<!-- politty:usage:heavy:start -->

**Usage**

```
my-app heavy [options]
```

<!-- politty:usage:heavy:end -->

<!-- politty:options:heavy:start -->

**Options**

| Option                      | Alias | Description          | Required | Default |
| --------------------------- | ----- | -------------------- | -------- | ------- |
| `--iterations <ITERATIONS>` | `-n`  | Number of iterations | No       | `1000`  |
| `--verbose`                 | `-v`  | Verbose output       | No       | `false` |

<!-- politty:options:heavy:end -->

<!-- politty:heading:status:start -->

## status

<!-- politty:heading:status:end -->

<!-- politty:description:status:start -->

Show current status (eagerly loaded)

<!-- politty:description:status:end -->

<!-- politty:usage:status:start -->

**Usage**

```
my-app status [options]
```

<!-- politty:usage:status:end -->

<!-- politty:options:status:start -->

**Options**

| Option      | Alias | Description          | Required | Default |
| ----------- | ----- | -------------------- | -------- | ------- |
| `--verbose` | `-v`  | Show detailed status | No       | `false` |

<!-- politty:options:status:end -->
