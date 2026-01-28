<!-- politty:command::start -->

# git-like

Example of displaying subcommand options together

**Usage**

```
git-like [command]
```

**Commands**

| Command             | Description          |
| ------------------- | -------------------- |
| [`config`](#config) | Manage configuration |
| [`remote`](#remote) | Manage remotes       |

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

| Option              | Alias | Description               | Default   |
| ------------------- | ----- | ------------------------- | --------- |
| `--format <FORMAT>` | `-f`  | Output format             | `"table"` |
| `--global`          | `-g`  | Show global configuration | `false`   |

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
<!-- politty:command:remote:start -->

## remote

Manage remotes

**Usage**

```
git-like remote [command]
```

**Commands**

| Command                           | Description   |
| --------------------------------- | ------------- |
| [`remote add`](#remote-add)       | Add remote    |
| [`remote remove`](#remote-remove) | Remove remote |

<!-- politty:command:remote:end -->
<!-- politty:command:remote add:start -->

### remote add

Add remote

**Usage**

```
git-like remote add <name> <url>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Remote name | Yes      |
| `url`    | Remote URL  | Yes      |

<!-- politty:command:remote add:end -->
<!-- politty:command:remote remove:start -->

### remote remove

Remove remote

**Usage**

```
git-like remote remove [options] <name>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Remote name | Yes      |

**Options**

| Option    | Alias | Description    | Default |
| --------- | ----- | -------------- | ------- |
| `--force` | `-f`  | Force deletion | `false` |

<!-- politty:command:remote remove:end -->
