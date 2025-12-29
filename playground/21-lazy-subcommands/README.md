# my-app

CLI demonstrating lazy loading subcommands with dynamic imports

## Usage

```
my-app [command]
```

## Commands

| Command | Description |
|---------|-------------|
| [`status`](#status) | Show current status (eagerly loaded) |
| [`heavy`](#heavy) | A heavy command that is lazily loaded |
| [`analytics`](#analytics) | Analyze project metrics (lazily loaded) |

---

# analytics

Analyze project metrics (lazily loaded)

## Usage

```
my-app analytics [options]
```

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--metric <METRIC>` | `-m` | Metric to analyze | `"lines"` |
| `--format <FORMAT>` | `-f` | Output format | `"text"` |

---

# heavy

A heavy command that is lazily loaded

## Usage

```
my-app heavy [options]
```

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--iterations <ITERATIONS>` | `-n` | Number of iterations | `1000` |
| `--verbose` | `-v` | Verbose output | `false` |

---

# status

Show current status (eagerly loaded)

## Usage

```
my-app status [options]
```

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--verbose` | `-v` | Show detailed status | `false` |
