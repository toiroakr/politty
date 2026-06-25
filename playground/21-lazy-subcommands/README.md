# my-app

CLI demonstrating lazy loading subcommands with dynamic imports

**Usage**

```
my-app <command>
```

**Commands**

| Command                   | Description                             |
| ------------------------- | --------------------------------------- |
| [`status`](#status)       | Show current status (eagerly loaded)    |
| [`heavy`](#heavy)         | A heavy command that is lazily loaded   |
| [`analytics`](#analytics) | Analyze project metrics (lazily loaded) |

## analytics

Analyze project metrics (lazily loaded)

**Usage**

```
my-app analytics [options]
```

**Options**

| Option              | Alias | Description       | Required | Default   |
| ------------------- | ----- | ----------------- | -------- | --------- |
| `--metric <METRIC>` | `-m`  | Metric to analyze | No       | `"lines"` |
| `--format <FORMAT>` | `-f`  | Output format     | No       | `"text"`  |

## heavy

A heavy command that is lazily loaded

**Usage**

```
my-app heavy [options]
```

**Options**

| Option                      | Alias | Description          | Required | Default |
| --------------------------- | ----- | -------------------- | -------- | ------- |
| `--iterations <ITERATIONS>` | `-n`  | Number of iterations | No       | `1000`  |
| `--verbose`                 | `-v`  | Verbose output       | No       | `false` |

## status

Show current status (eagerly loaded)

**Usage**

```
my-app status [options]
```

**Options**

| Option      | Alias | Description          | Required | Default |
| ----------- | ----- | -------------------- | -------- | ------- |
| `--verbose` | `-v`  | Show detailed status | No       | `false` |
