<!-- politty:heading::start -->

# git-like

<!-- politty:heading::end -->

<!-- politty:description::start -->

Git-style nested subcommand example

<!-- politty:description::end -->

<!-- politty:usage::start -->

**Usage**

```
git-like [command]
```

<!-- politty:usage::end -->

<!-- politty:subcommands::start -->

**Commands**

| Command             | Description          |
| ------------------- | -------------------- |
| [`config`](#config) | Manage configuration |

<!-- politty:subcommands::end -->

<!-- politty:heading:config:start -->

## config

<!-- politty:heading:config:end -->

<!-- politty:description:config:start -->

Manage configuration

<!-- politty:description:config:end -->

<!-- politty:usage:config:start -->

**Usage**

```
git-like config [command]
```

<!-- politty:usage:config:end -->

<!-- politty:subcommands:config:start -->

**Commands**

| Command                       | Description            |
| ----------------------------- | ---------------------- |
| [`config get`](#config-get)   | Get a config value     |
| [`config set`](#config-set)   | Set a config value     |
| [`config list`](#config-list) | List all config values |

<!-- politty:subcommands:config:end -->

<!-- politty:heading:config get:start -->

### config get

<!-- politty:heading:config get:end -->

<!-- politty:description:config get:start -->

Get a config value

<!-- politty:description:config get:end -->

<!-- politty:usage:config get:start -->

**Usage**

```
git-like config get <key>
```

<!-- politty:usage:config get:end -->

<!-- politty:arguments:config get:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `key`    | Config key  | Yes      |

<!-- politty:arguments:config get:end -->

<!-- politty:heading:config list:start -->

### config list

<!-- politty:heading:config list:end -->

<!-- politty:description:config list:start -->

List all config values

<!-- politty:description:config list:end -->

<!-- politty:usage:config list:start -->

**Usage**

```
git-like config list [options]
```

<!-- politty:usage:config list:end -->

<!-- politty:options:config list:start -->

**Options**

| Option              | Alias | Description   | Required | Default   |
| ------------------- | ----- | ------------- | -------- | --------- |
| `--format <FORMAT>` | `-f`  | Output format | No       | `"table"` |

<!-- politty:options:config list:end -->

<!-- politty:heading:config set:start -->

### config set

<!-- politty:heading:config set:end -->

<!-- politty:description:config set:start -->

Set a config value

<!-- politty:description:config set:end -->

<!-- politty:usage:config set:start -->

**Usage**

```
git-like config set <key> <value>
```

<!-- politty:usage:config set:end -->

<!-- politty:arguments:config set:start -->

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `key`    | Config key   | Yes      |
| `value`  | Config value | Yes      |

<!-- politty:arguments:config set:end -->
