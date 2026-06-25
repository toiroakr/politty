# git-like

Git-style nested subcommand example

**Usage**

```
git-like <command>
```

**Commands**

| Command             | Description          |
| ------------------- | -------------------- |
| [`config`](#config) | Manage configuration |

## config

Manage configuration

**Usage**

```
git-like config <command>
```

**Commands**

| Command                       | Description            |
| ----------------------------- | ---------------------- |
| [`config get`](#config-get)   | Get a config value     |
| [`config set`](#config-set)   | Set a config value     |
| [`config list`](#config-list) | List all config values |

### config get

Get a config value

**Usage**

```
git-like config get <key>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `key`    | Config key  | Yes      |

### config list

List all config values

**Usage**

```
git-like config list [options]
```

**Options**

| Option              | Alias | Description   | Required | Default   |
| ------------------- | ----- | ------------- | -------- | --------- |
| `--format <FORMAT>` | `-f`  | Output format | No       | `"table"` |

### config set

Set a config value

**Usage**

```
git-like config set <key> <value>
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `key`    | Config key   | Yes      |
| `value`  | Config value | Yes      |
