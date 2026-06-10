<!-- politty:command::start -->

# pkg

A package manager CLI with command aliases

**Usage**

```
pkg [command]
```

**Commands**

| Command               | Aliases           | Description             |
| --------------------- | ----------------- | ----------------------- |
| [`install`](#install) | `i`, `add`        | Install packages        |
| [`remove`](#remove)   | `rm`, `uninstall` | Remove packages         |
| [`list`](#list)       | `ls`              | List installed packages |

<!-- politty:command::end -->

<!-- politty:command:install:start -->

## install

Install packages

**Aliases:** `i`, `add`

**Usage**

```
pkg install [options] [packages]
```

**Arguments**

| Argument   | Description         | Required |
| ---------- | ------------------- | -------- |
| `packages` | Packages to install | No       |

**Options**

| Option       | Alias | Description            | Required | Default |
| ------------ | ----- | ---------------------- | -------- | ------- |
| `--save-dev` | `-D`  | Save as dev dependency | No       | `false` |
| `--global`   | `-g`  | Install globally       | No       | `false` |

<!-- politty:command:install:end -->

<!-- politty:command:list:start -->

## list

List installed packages

**Aliases:** `ls`

**Usage**

```
pkg list [options]
```

**Options**

| Option            | Alias | Description              | Required | Default |
| ----------------- | ----- | ------------------------ | -------- | ------- |
| `--depth <DEPTH>` | `-d`  | Depth of dependency tree | No       | `0`     |

<!-- politty:command:list:end -->

<!-- politty:command:remove:start -->

## remove

Remove packages

**Aliases:** `rm`, `uninstall`

**Usage**

```
pkg remove <packages>
```

**Arguments**

| Argument   | Description        | Required |
| ---------- | ------------------ | -------- |
| `packages` | Packages to remove | Yes      |

<!-- politty:command:remove:end -->
