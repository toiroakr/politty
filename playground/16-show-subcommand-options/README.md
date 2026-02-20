<!-- politty:heading::start -->

# git-like

<!-- politty:heading::end -->

<!-- politty:description::start -->

Example of displaying subcommand options together

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
| [`remote`](#remote) | Manage remotes       |

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

| Option              | Alias | Description               | Required | Default   |
| ------------------- | ----- | ------------------------- | -------- | --------- |
| `--format <FORMAT>` | `-f`  | Output format             | No       | `"table"` |
| `--global`          | `-g`  | Show global configuration | No       | `false`   |

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

<!-- politty:heading:remote:start -->

## remote

<!-- politty:heading:remote:end -->

<!-- politty:description:remote:start -->

Manage remotes

<!-- politty:description:remote:end -->

<!-- politty:usage:remote:start -->

**Usage**

```
git-like remote [command]
```

<!-- politty:usage:remote:end -->

<!-- politty:subcommands:remote:start -->

**Commands**

| Command                           | Description   |
| --------------------------------- | ------------- |
| [`remote add`](#remote-add)       | Add remote    |
| [`remote remove`](#remote-remove) | Remove remote |

<!-- politty:subcommands:remote:end -->

<!-- politty:heading:remote add:start -->

### remote add

<!-- politty:heading:remote add:end -->

<!-- politty:description:remote add:start -->

Add remote

<!-- politty:description:remote add:end -->

<!-- politty:usage:remote add:start -->

**Usage**

```
git-like remote add <name> <url>
```

<!-- politty:usage:remote add:end -->

<!-- politty:arguments:remote add:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Remote name | Yes      |
| `url`    | Remote URL  | Yes      |

<!-- politty:arguments:remote add:end -->

<!-- politty:heading:remote remove:start -->

### remote remove

<!-- politty:heading:remote remove:end -->

<!-- politty:description:remote remove:start -->

Remove remote

<!-- politty:description:remote remove:end -->

<!-- politty:usage:remote remove:start -->

**Usage**

```
git-like remote remove [options] <name>
```

<!-- politty:usage:remote remove:end -->

<!-- politty:arguments:remote remove:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Remote name | Yes      |

<!-- politty:arguments:remote remove:end -->

<!-- politty:options:remote remove:start -->

**Options**

| Option    | Alias | Description    | Required | Default |
| --------- | ----- | -------------- | -------- | ------- |
| `--force` | `-f`  | Force deletion | No       | `false` |

<!-- politty:options:remote remove:end -->
