<!-- politty:command::heading:start -->

# file-cli

<!-- politty:command::heading:end -->

<!-- politty:command::description:start -->

File operations CLI with examples

<!-- politty:command::description:end -->

<!-- politty:command::usage:start -->

**Usage**

```
file-cli [command]
```

<!-- politty:command::usage:end -->

<!-- politty:command::subcommands:start -->

**Commands**

| Command             | Description           |
| ------------------- | --------------------- |
| [`read`](#read)     | Read file contents    |
| [`write`](#write)   | Write content to file |
| [`check`](#check)   | Check if file exists  |
| [`delete`](#delete) | Delete a file         |

<!-- politty:command::subcommands:end -->
<!-- politty:command:read:heading:start -->

## read

<!-- politty:command:read:heading:end -->

<!-- politty:command:read:description:start -->

Read file contents

<!-- politty:command:read:description:end -->

<!-- politty:command:read:usage:start -->

**Usage**

```
file-cli read [options] <file>
```

<!-- politty:command:read:usage:end -->

<!-- politty:command:read:arguments:start -->

**Arguments**

| Argument | Description       | Required |
| -------- | ----------------- | -------- |
| `file`   | File path to read | Yes      |

<!-- politty:command:read:arguments:end -->

<!-- politty:command:read:options:start -->

**Options**

| Option              | Alias | Description   | Required | Default  |
| ------------------- | ----- | ------------- | -------- | -------- |
| `--format <FORMAT>` | `-f`  | Output format | No       | `"text"` |

<!-- politty:command:read:options:end -->

<!-- politty:command:read:examples:start -->

**Examples**

**Read a JSON config file**

```bash
$ file-cli read config.json
{
  "name": "my-app",
  "version": "1.0.0"
}
```

**Read a text file**

```bash
$ file-cli read data.txt -f text
Hello from data.txt
```

<!-- politty:command:read:examples:end -->
<!-- politty:command:write:heading:start -->

## write

<!-- politty:command:write:heading:end -->

<!-- politty:command:write:description:start -->

Write content to file

<!-- politty:command:write:description:end -->

<!-- politty:command:write:usage:start -->

**Usage**

```
file-cli write [options] <file> <content>
```

<!-- politty:command:write:usage:end -->

<!-- politty:command:write:arguments:start -->

**Arguments**

| Argument  | Description        | Required |
| --------- | ------------------ | -------- |
| `file`    | File path to write | Yes      |
| `content` | Content to write   | Yes      |

<!-- politty:command:write:arguments:end -->

<!-- politty:command:write:options:start -->

**Options**

| Option     | Alias | Description                           | Required | Default |
| ---------- | ----- | ------------------------------------- | -------- | ------- |
| `--append` | `-a`  | Append to file instead of overwriting | No       | `false` |

<!-- politty:command:write:options:end -->

<!-- politty:command:write:examples:start -->

**Examples**

**Write text to a file**

```bash
$ file-cli write output.txt "Hello, World!"
Successfully written to output.txt
```

**Append text to a file**

```bash
$ file-cli write log.txt "New entry" --append
Successfully appended to log.txt
```

<!-- politty:command:write:examples:end -->
<!-- politty:command:check:heading:start -->

## check

<!-- politty:command:check:heading:end -->

<!-- politty:command:check:description:start -->

Check if file exists

<!-- politty:command:check:description:end -->

<!-- politty:command:check:usage:start -->

**Usage**

```
file-cli check <file>
```

<!-- politty:command:check:usage:end -->

<!-- politty:command:check:arguments:start -->

**Arguments**

| Argument | Description        | Required |
| -------- | ------------------ | -------- |
| `file`   | File path to check | Yes      |

<!-- politty:command:check:arguments:end -->

<!-- politty:command:check:examples:start -->

**Examples**

**Check if config file exists**

```bash
$ file-cli check config.json
File exists: config.json
```

**Check non-existent file**

```bash
$ file-cli check missing.txt
File not found: missing.txt
```

<!-- politty:command:check:examples:end -->

<!-- politty:command:delete:heading:start -->

## delete

<!-- politty:command:delete:heading:end -->

<!-- politty:command:delete:description:start -->

Delete a file

<!-- politty:command:delete:description:end -->

<!-- politty:command:delete:usage:start -->

**Usage**

```
file-cli delete [options] <file>
```

<!-- politty:command:delete:usage:end -->

<!-- politty:command:delete:arguments:start -->

**Arguments**

| Argument | Description         | Required |
| -------- | ------------------- | -------- |
| `file`   | File path to delete | Yes      |

<!-- politty:command:delete:arguments:end -->

<!-- politty:command:delete:options:start -->

**Options**

| Option    | Alias | Description                         | Required | Default |
| --------- | ----- | ----------------------------------- | -------- | ------- |
| `--force` | `-f`  | Force deletion without confirmation | No       | `false` |

<!-- politty:command:delete:options:end -->
