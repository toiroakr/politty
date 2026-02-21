<!-- politty:command::heading:start -->

# git-like

<!-- politty:command::heading:end -->

<!-- politty:command::description:start -->

Example of displaying subcommand options together

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
| [`remote`](#remote) | Manage remotes       |

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

| Option              | Alias | Description               | Required | Default   |
| ------------------- | ----- | ------------------------- | -------- | --------- |
| `--format <FORMAT>` | `-f`  | Output format             | No       | `"table"` |
| `--global`          | `-g`  | Show global configuration | No       | `false`   |

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

<!-- politty:command:remote:heading:start -->

## remote

<!-- politty:command:remote:heading:end -->

<!-- politty:command:remote:description:start -->

Manage remotes

<!-- politty:command:remote:description:end -->

<!-- politty:command:remote:usage:start -->

**Usage**

```
git-like remote [command]
```

<!-- politty:command:remote:usage:end -->

<!-- politty:command:remote:subcommands:start -->

**Commands**

| Command                           | Description   |
| --------------------------------- | ------------- |
| [`remote add`](#remote-add)       | Add remote    |
| [`remote remove`](#remote-remove) | Remove remote |

<!-- politty:command:remote:subcommands:end -->

<!-- politty:command:remote add:heading:start -->

### remote add

<!-- politty:command:remote add:heading:end -->

<!-- politty:command:remote add:description:start -->

Add remote

<!-- politty:command:remote add:description:end -->

<!-- politty:command:remote add:usage:start -->

**Usage**

```
git-like remote add <name> <url>
```

<!-- politty:command:remote add:usage:end -->

<!-- politty:command:remote add:arguments:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Remote name | Yes      |
| `url`    | Remote URL  | Yes      |

<!-- politty:command:remote add:arguments:end -->

<!-- politty:command:remote remove:heading:start -->

### remote remove

<!-- politty:command:remote remove:heading:end -->

<!-- politty:command:remote remove:description:start -->

Remove remote

<!-- politty:command:remote remove:description:end -->

<!-- politty:command:remote remove:usage:start -->

**Usage**

```
git-like remote remove [options] <name>
```

<!-- politty:command:remote remove:usage:end -->

<!-- politty:command:remote remove:arguments:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Remote name | Yes      |

<!-- politty:command:remote remove:arguments:end -->

<!-- politty:command:remote remove:options:start -->

**Options**

| Option    | Alias | Description    | Required | Default |
| --------- | ----- | -------------- | -------- | ------- |
| `--force` | `-f`  | Force deletion | No       | `false` |

<!-- politty:command:remote remove:options:end -->
