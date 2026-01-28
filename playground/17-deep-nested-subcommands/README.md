<!-- politty:command::start -->

# git-like

Example of 3-level nested subcommands

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

| Command                       | Description          |
| ----------------------------- | -------------------- |
| [`config user`](#config-user) | Manage user settings |
| [`config core`](#config-core) | Manage core settings |

<!-- politty:command:config:end -->
<!-- politty:command:config core:start -->

### config core

Manage core settings

**Usage**

```
git-like config core [command]
```

**Commands**

| Command                               | Description           |
| ------------------------------------- | --------------------- |
| [`config core get`](#config-core-get) | Get core config value |
| [`config core set`](#config-core-set) | Set core config value |

<!-- politty:command:config core:end -->
<!-- politty:command:config core get:start -->

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

<!-- politty:command:config core get:end -->
<!-- politty:command:config core set:start -->

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

<!-- politty:command:config core set:end -->
<!-- politty:command:config user:start -->

### config user

Manage user settings

**Usage**

```
git-like config user [command]
```

**Commands**

| Command                               | Description           |
| ------------------------------------- | --------------------- |
| [`config user get`](#config-user-get) | Get user config value |
| [`config user set`](#config-user-set) | Set user config value |

<!-- politty:command:config user:end -->
<!-- politty:command:config user get:start -->

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

<!-- politty:command:config user get:end -->
<!-- politty:command:config user set:start -->

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

| Option     | Alias | Description                  | Default |
| ---------- | ----- | ---------------------------- | ------- |
| `--global` | `-g`  | Save as global configuration | `false` |

<!-- politty:command:config user set:end -->
