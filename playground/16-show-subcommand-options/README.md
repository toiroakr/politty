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

| Option              | Alias | Description               | Required | Default   |
| ------------------- | ----- | ------------------------- | -------- | --------- |
| `--format <FORMAT>` | `-f`  | Output format             | No       | `"table"` |
| `--global`          | `-g`  | Show global configuration | No       | `false`   |

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

| Option    | Alias | Description    | Required | Default |
| --------- | ----- | -------------- | -------- | ------- |
| `--force` | `-f`  | Force deletion | No       | `false` |
