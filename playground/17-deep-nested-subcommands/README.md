<!-- politty:heading::start -->

# git-like

<!-- politty:heading::end -->

<!-- politty:description::start -->

Example of 3-level nested subcommands

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

| Command                       | Description          |
| ----------------------------- | -------------------- |
| [`config user`](#config-user) | Manage user settings |
| [`config core`](#config-core) | Manage core settings |

<!-- politty:subcommands:config:end -->

<!-- politty:heading:config core:start -->

### config core

<!-- politty:heading:config core:end -->

<!-- politty:description:config core:start -->

Manage core settings

<!-- politty:description:config core:end -->

<!-- politty:usage:config core:start -->

**Usage**

```
git-like config core [command]
```

<!-- politty:usage:config core:end -->

<!-- politty:subcommands:config core:start -->

**Commands**

| Command                               | Description           |
| ------------------------------------- | --------------------- |
| [`config core get`](#config-core-get) | Get core config value |
| [`config core set`](#config-core-set) | Set core config value |

<!-- politty:subcommands:config core:end -->

<!-- politty:heading:config core get:start -->

#### config core get

<!-- politty:heading:config core get:end -->

<!-- politty:description:config core get:start -->

Get core config value

<!-- politty:description:config core get:end -->

<!-- politty:usage:config core get:start -->

**Usage**

```
git-like config core get <key>
```

<!-- politty:usage:config core get:end -->

<!-- politty:arguments:config core get:start -->

**Arguments**

| Argument | Description                    | Required |
| -------- | ------------------------------ | -------- |
| `key`    | Config key (editor, pager etc) | Yes      |

<!-- politty:arguments:config core get:end -->

<!-- politty:heading:config core set:start -->

#### config core set

<!-- politty:heading:config core set:end -->

<!-- politty:description:config core set:start -->

Set core config value

<!-- politty:description:config core set:end -->

<!-- politty:usage:config core set:start -->

**Usage**

```
git-like config core set <key> <value>
```

<!-- politty:usage:config core set:end -->

<!-- politty:arguments:config core set:start -->

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `key`    | Config key   | Yes      |
| `value`  | Config value | Yes      |

<!-- politty:arguments:config core set:end -->

<!-- politty:heading:config user:start -->

### config user

<!-- politty:heading:config user:end -->

<!-- politty:description:config user:start -->

Manage user settings

<!-- politty:description:config user:end -->

<!-- politty:usage:config user:start -->

**Usage**

```
git-like config user [command]
```

<!-- politty:usage:config user:end -->

<!-- politty:subcommands:config user:start -->

**Commands**

| Command                               | Description           |
| ------------------------------------- | --------------------- |
| [`config user get`](#config-user-get) | Get user config value |
| [`config user set`](#config-user-set) | Set user config value |

<!-- politty:subcommands:config user:end -->

<!-- politty:heading:config user get:start -->

#### config user get

<!-- politty:heading:config user get:end -->

<!-- politty:description:config user get:start -->

Get user config value

<!-- politty:description:config user get:end -->

<!-- politty:usage:config user get:start -->

**Usage**

```
git-like config user get <key>
```

<!-- politty:usage:config user get:end -->

<!-- politty:arguments:config user get:start -->

**Arguments**

| Argument | Description                  | Required |
| -------- | ---------------------------- | -------- |
| `key`    | Config key (name, email etc) | Yes      |

<!-- politty:arguments:config user get:end -->

<!-- politty:heading:config user set:start -->

#### config user set

<!-- politty:heading:config user set:end -->

<!-- politty:description:config user set:start -->

Set user config value

<!-- politty:description:config user set:end -->

<!-- politty:usage:config user set:start -->

**Usage**

```
git-like config user set [options] <key> <value>
```

<!-- politty:usage:config user set:end -->

<!-- politty:arguments:config user set:start -->

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `key`    | Config key   | Yes      |
| `value`  | Config value | Yes      |

<!-- politty:arguments:config user set:end -->

<!-- politty:options:config user set:start -->

**Options**

| Option     | Alias | Description                  | Required | Default |
| ---------- | ----- | ---------------------------- | -------- | ------- |
| `--global` | `-g`  | Save as global configuration | No       | `false` |

<!-- politty:options:config user set:end -->
