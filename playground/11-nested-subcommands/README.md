<!-- politty:command::start -->

# git-like

Git-style nested subcommand example

**Usage**

```
git-like [command]
```

**Commands**

| Command             | Description          |
| ------------------- | -------------------- |
| [`config`](#config) | Manage configuration |

<!-- politty:command::end -->
<!-- politty:command:config:start -->

## config

Manage configuration

**Usage**

```
git-like config [command]
```

**Commands**

| Command                       | Description            |
| ----------------------------- | ---------------------- |
| [`config get`](#config-get)   | Get a config value     |
| [`config set`](#config-set)   | Set a config value     |
| [`config list`](#config-list) | List all config values |

<!-- politty:command:config:end -->
<!-- politty:command:config get:start -->

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

<!-- politty:command:config get:end -->
<!-- politty:command:config list:start -->

### config list

List all config values

**Usage**

```
git-like config list [options]
```

**Options**

| Option              | Alias | Description   | Default   |
| ------------------- | ----- | ------------- | --------- |
| `--format <FORMAT>` | `-f`  | Output format | `"table"` |

<!-- politty:command:config list:end -->
<!-- politty:command:config set:start -->

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

<!-- politty:command:config set:end -->
