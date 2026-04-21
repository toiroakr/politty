<!-- politty:command::heading:start -->

# pkg

<!-- politty:command::heading:end -->

<!-- politty:command::description:start -->

A package manager CLI with command aliases

<!-- politty:command::description:end -->

<!-- politty:command::usage:start -->

**Usage**

```
pkg [command]
```

<!-- politty:command::usage:end -->

<!-- politty:command::subcommands:start -->

**Commands**

| Command               | Aliases           | Description             |
| --------------------- | ----------------- | ----------------------- |
| [`install`](#install) | `i`, `add`        | Install packages        |
| [`remove`](#remove)   | `rm`, `uninstall` | Remove packages         |
| [`list`](#list)       | `ls`              | List installed packages |

<!-- politty:command::subcommands:end -->
<!-- politty:command:install:heading:start -->

## install

<!-- politty:command:install:heading:end -->

<!-- politty:command:install:description:start -->

Install packages

**Aliases:** `i`, `add`

<!-- politty:command:install:description:end -->

<!-- politty:command:install:usage:start -->

**Usage**

```
pkg install [options] [packages]
```

<!-- politty:command:install:usage:end -->

<!-- politty:command:install:arguments:start -->

**Arguments**

| Argument   | Description         | Required |
| ---------- | ------------------- | -------- |
| `packages` | Packages to install | No       |

<!-- politty:command:install:arguments:end -->

<!-- politty:command:install:options:start -->

**Options**

| Option       | Alias | Description            | Required | Default |
| ------------ | ----- | ---------------------- | -------- | ------- |
| `--save-dev` | `-D`  | Save as dev dependency | No       | `false` |
| `--global`   | `-g`  | Install globally       | No       | `false` |

<!-- politty:command:install:options:end -->
<!-- politty:command:list:heading:start -->

## list

<!-- politty:command:list:heading:end -->

<!-- politty:command:list:description:start -->

List installed packages

**Aliases:** `ls`

<!-- politty:command:list:description:end -->

<!-- politty:command:list:usage:start -->

**Usage**

```
pkg list [options]
```

<!-- politty:command:list:usage:end -->

<!-- politty:command:list:options:start -->

**Options**

| Option            | Alias | Description              | Required | Default |
| ----------------- | ----- | ------------------------ | -------- | ------- |
| `--depth <DEPTH>` | `-d`  | Depth of dependency tree | No       | `0`     |

<!-- politty:command:list:options:end -->

<!-- politty:command:remove:heading:start -->

## remove

<!-- politty:command:remove:heading:end -->

<!-- politty:command:remove:description:start -->

Remove packages

**Aliases:** `rm`, `uninstall`

<!-- politty:command:remove:description:end -->

<!-- politty:command:remove:usage:start -->

**Usage**

```
pkg remove <packages>
```

<!-- politty:command:remove:usage:end -->

<!-- politty:command:remove:arguments:start -->

**Arguments**

| Argument   | Description        | Required |
| ---------- | ------------------ | -------- |
| `packages` | Packages to remove | Yes      |

<!-- politty:command:remove:arguments:end -->
