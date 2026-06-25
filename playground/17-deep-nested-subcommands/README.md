# git-like

Example of 3-level nested subcommands

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

| Command                       | Description          |
| ----------------------------- | -------------------- |
| [`config user`](#config-user) | Manage user settings |
| [`config core`](#config-core) | Manage core settings |

### config core

Manage core settings

**Usage**

```
git-like config core <command>
```

**Commands**

| Command                               | Description           |
| ------------------------------------- | --------------------- |
| [`config core get`](#config-core-get) | Get core config value |
| [`config core set`](#config-core-set) | Set core config value |

#### config core get

Get core config value

**Usage**

```
git-like config core get <key>
```

**Arguments**

| Argument | Description                    | Required |
| -------- | ------------------------------ | -------- |
| `key`    | Config key (editor, pager etc) | Yes      |

#### config core set

Set core config value

**Usage**

```
git-like config core set <key> <value>
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `key`    | Config key   | Yes      |
| `value`  | Config value | Yes      |

### config user

Manage user settings

**Usage**

```
git-like config user <command>
```

**Commands**

| Command                               | Description           |
| ------------------------------------- | --------------------- |
| [`config user get`](#config-user-get) | Get user config value |
| [`config user set`](#config-user-set) | Set user config value |

#### config user get

Get user config value

**Usage**

```
git-like config user get <key>
```

**Arguments**

| Argument | Description                  | Required |
| -------- | ---------------------------- | -------- |
| `key`    | Config key (name, email etc) | Yes      |

#### config user set

Set user config value

**Usage**

```
git-like config user set [options] <key> <value>
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `key`    | Config key   | Yes      |
| `value`  | Config value | Yes      |

**Options**

| Option     | Alias | Description                  | Required | Default |
| ---------- | ----- | ---------------------------- | -------- | ------- |
| `--global` | `-g`  | Save as global configuration | No       | `false` |
