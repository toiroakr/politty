<!-- politty:command::heading:start -->

# git-like

<!-- politty:command::heading:end -->

<!-- politty:command::description:start -->

Example of 3-level nested subcommands

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

| Command                       | Description          |
| ----------------------------- | -------------------- |
| [`config user`](#config-user) | Manage user settings |
| [`config core`](#config-core) | Manage core settings |

<!-- politty:command:config:subcommands:end -->

<!-- politty:command:config core:heading:start -->

### config core

<!-- politty:command:config core:heading:end -->

<!-- politty:command:config core:description:start -->

Manage core settings

<!-- politty:command:config core:description:end -->

<!-- politty:command:config core:usage:start -->

**Usage**

```
git-like config core [command]
```

<!-- politty:command:config core:usage:end -->

<!-- politty:command:config core:subcommands:start -->

**Commands**

| Command                               | Description           |
| ------------------------------------- | --------------------- |
| [`config core get`](#config-core-get) | Get core config value |
| [`config core set`](#config-core-set) | Set core config value |

<!-- politty:command:config core:subcommands:end -->

<!-- politty:command:config core get:heading:start -->

#### config core get

<!-- politty:command:config core get:heading:end -->

<!-- politty:command:config core get:description:start -->

Get core config value

<!-- politty:command:config core get:description:end -->

<!-- politty:command:config core get:usage:start -->

**Usage**

```
git-like config core get <key>
```

<!-- politty:command:config core get:usage:end -->

<!-- politty:command:config core get:arguments:start -->

**Arguments**

| Argument | Description                    | Required |
| -------- | ------------------------------ | -------- |
| `key`    | Config key (editor, pager etc) | Yes      |

<!-- politty:command:config core get:arguments:end -->

<!-- politty:command:config core set:heading:start -->

#### config core set

<!-- politty:command:config core set:heading:end -->

<!-- politty:command:config core set:description:start -->

Set core config value

<!-- politty:command:config core set:description:end -->

<!-- politty:command:config core set:usage:start -->

**Usage**

```
git-like config core set <key> <value>
```

<!-- politty:command:config core set:usage:end -->

<!-- politty:command:config core set:arguments:start -->

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `key`    | Config key   | Yes      |
| `value`  | Config value | Yes      |

<!-- politty:command:config core set:arguments:end -->

<!-- politty:command:config user:heading:start -->

### config user

<!-- politty:command:config user:heading:end -->

<!-- politty:command:config user:description:start -->

Manage user settings

<!-- politty:command:config user:description:end -->

<!-- politty:command:config user:usage:start -->

**Usage**

```
git-like config user [command]
```

<!-- politty:command:config user:usage:end -->

<!-- politty:command:config user:subcommands:start -->

**Commands**

| Command                               | Description           |
| ------------------------------------- | --------------------- |
| [`config user get`](#config-user-get) | Get user config value |
| [`config user set`](#config-user-set) | Set user config value |

<!-- politty:command:config user:subcommands:end -->

<!-- politty:command:config user get:heading:start -->

#### config user get

<!-- politty:command:config user get:heading:end -->

<!-- politty:command:config user get:description:start -->

Get user config value

<!-- politty:command:config user get:description:end -->

<!-- politty:command:config user get:usage:start -->

**Usage**

```
git-like config user get <key>
```

<!-- politty:command:config user get:usage:end -->

<!-- politty:command:config user get:arguments:start -->

**Arguments**

| Argument | Description                  | Required |
| -------- | ---------------------------- | -------- |
| `key`    | Config key (name, email etc) | Yes      |

<!-- politty:command:config user get:arguments:end -->

<!-- politty:command:config user set:heading:start -->

#### config user set

<!-- politty:command:config user set:heading:end -->

<!-- politty:command:config user set:description:start -->

Set user config value

<!-- politty:command:config user set:description:end -->

<!-- politty:command:config user set:usage:start -->

**Usage**

```
git-like config user set [options] <key> <value>
```

<!-- politty:command:config user set:usage:end -->

<!-- politty:command:config user set:arguments:start -->

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `key`    | Config key   | Yes      |
| `value`  | Config value | Yes      |

<!-- politty:command:config user set:arguments:end -->

<!-- politty:command:config user set:options:start -->

**Options**

| Option     | Alias | Description                  | Required | Default |
| ---------- | ----- | ---------------------------- | -------- | ------- |
| `--global` | `-g`  | Save as global configuration | No       | `false` |

<!-- politty:command:config user set:options:end -->
