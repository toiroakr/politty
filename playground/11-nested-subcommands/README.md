<!-- politty:command::heading:start -->

# git-like

<!-- politty:command::heading:end -->

<!-- politty:command::description:start -->

Git-style nested subcommand example

<!-- politty:command::description:end -->

<!-- politty:command::usage:start -->

**Usage**

```
git-like [command]
```

<!-- politty:command::usage:end -->

<!-- politty:command::subcommands:start -->

**Commands**

| Command             | Description          |
| ------------------- | -------------------- |
| [`config`](#config) | Manage configuration |

<!-- politty:command::subcommands:end -->

<!-- politty:command:config:heading:start -->

## config

<!-- politty:command:config:heading:end -->

<!-- politty:command:config:description:start -->

Manage configuration

<!-- politty:command:config:description:end -->

<!-- politty:command:config:usage:start -->

**Usage**

```
git-like config [command]
```

<!-- politty:command:config:usage:end -->

<!-- politty:command:config:subcommands:start -->

**Commands**

| Command                       | Description            |
| ----------------------------- | ---------------------- |
| [`config get`](#config-get)   | Get a config value     |
| [`config set`](#config-set)   | Set a config value     |
| [`config list`](#config-list) | List all config values |

<!-- politty:command:config:subcommands:end -->

<!-- politty:command:config get:heading:start -->

### config get

<!-- politty:command:config get:heading:end -->

<!-- politty:command:config get:description:start -->

Get a config value

<!-- politty:command:config get:description:end -->

<!-- politty:command:config get:usage:start -->

**Usage**

```
git-like config get <key>
```

<!-- politty:command:config get:usage:end -->

<!-- politty:command:config get:arguments:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `key`    | Config key  | Yes      |

<!-- politty:command:config get:arguments:end -->

<!-- politty:command:config list:heading:start -->

### config list

<!-- politty:command:config list:heading:end -->

<!-- politty:command:config list:description:start -->

List all config values

<!-- politty:command:config list:description:end -->

<!-- politty:command:config list:usage:start -->

**Usage**

```
git-like config list [options]
```

<!-- politty:command:config list:usage:end -->

<!-- politty:command:config list:options:start -->

**Options**

| Option              | Alias | Description   | Required | Default   |
| ------------------- | ----- | ------------- | -------- | --------- |
| `--format <FORMAT>` | `-f`  | Output format | No       | `"table"` |

<!-- politty:command:config list:options:end -->

<!-- politty:command:config set:heading:start -->

### config set

<!-- politty:command:config set:heading:end -->

<!-- politty:command:config set:description:start -->

Set a config value

<!-- politty:command:config set:description:end -->

<!-- politty:command:config set:usage:start -->

**Usage**

```
git-like config set <key> <value>
```

<!-- politty:command:config set:usage:end -->

<!-- politty:command:config set:arguments:start -->

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `key`    | Config key   | Yes      |
| `value`  | Config value | Yes      |

<!-- politty:command:config set:arguments:end -->
