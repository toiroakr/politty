<!-- politty:heading::start -->

# file-cli

<!-- politty:heading::end -->

<!-- politty:description::start -->

File operations CLI with examples

<!-- politty:description::end -->

<!-- politty:usage::start -->

**Usage**

```
file-cli [command]
```

<!-- politty:usage::end -->

<!-- politty:subcommands::start -->

**Commands**

| Command             | Description           |
| ------------------- | --------------------- |
| [`read`](#read)     | Read file contents    |
| [`write`](#write)   | Write content to file |
| [`check`](#check)   | Check if file exists  |
| [`delete`](#delete) | Delete a file         |

<!-- politty:subcommands::end -->
<!-- politty:heading:read:start -->

## read

<!-- politty:heading:read:end -->

<!-- politty:description:read:start -->

Read file contents

<!-- politty:description:read:end -->

<!-- politty:usage:read:start -->

**Usage**

```
file-cli read [options] <file>
```

<!-- politty:usage:read:end -->

<!-- politty:arguments:read:start -->

**Arguments**

| Argument | Description       | Required |
| -------- | ----------------- | -------- |
| `file`   | File path to read | Yes      |

<!-- politty:arguments:read:end -->

<!-- politty:options:read:start -->

**Options**

| Option              | Alias | Description   | Required | Default  |
| ------------------- | ----- | ------------- | -------- | -------- |
| `--format <FORMAT>` | `-f`  | Output format | No       | `"text"` |

<!-- politty:options:read:end -->

<!-- politty:examples:read:start -->

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

<!-- politty:examples:read:end -->
<!-- politty:heading:write:start -->

## write

<!-- politty:heading:write:end -->

<!-- politty:description:write:start -->

Write content to file

<!-- politty:description:write:end -->

<!-- politty:usage:write:start -->

**Usage**

```
file-cli write [options] <file> <content>
```

<!-- politty:usage:write:end -->

<!-- politty:arguments:write:start -->

**Arguments**

| Argument  | Description        | Required |
| --------- | ------------------ | -------- |
| `file`    | File path to write | Yes      |
| `content` | Content to write   | Yes      |

<!-- politty:arguments:write:end -->

<!-- politty:options:write:start -->

**Options**

| Option     | Alias | Description                           | Required | Default |
| ---------- | ----- | ------------------------------------- | -------- | ------- |
| `--append` | `-a`  | Append to file instead of overwriting | No       | `false` |

<!-- politty:options:write:end -->

<!-- politty:examples:write:start -->

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

<!-- politty:examples:write:end -->
<!-- politty:heading:check:start -->

## check

<!-- politty:heading:check:end -->

<!-- politty:description:check:start -->

Check if file exists

<!-- politty:description:check:end -->

<!-- politty:usage:check:start -->

**Usage**

```
file-cli check <file>
```

<!-- politty:usage:check:end -->

<!-- politty:arguments:check:start -->

**Arguments**

| Argument | Description        | Required |
| -------- | ------------------ | -------- |
| `file`   | File path to check | Yes      |

<!-- politty:arguments:check:end -->

<!-- politty:examples:check:start -->

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

<!-- politty:examples:check:end -->

<!-- politty:heading:delete:start -->

## delete

<!-- politty:heading:delete:end -->

<!-- politty:description:delete:start -->

Delete a file

<!-- politty:description:delete:end -->

<!-- politty:usage:delete:start -->

**Usage**

```
file-cli delete [options] <file>
```

<!-- politty:usage:delete:end -->

<!-- politty:arguments:delete:start -->

**Arguments**

| Argument | Description         | Required |
| -------- | ------------------- | -------- |
| `file`   | File path to delete | Yes      |

<!-- politty:arguments:delete:end -->

<!-- politty:options:delete:start -->

**Options**

| Option    | Alias | Description                         | Required | Default |
| --------- | ----- | ----------------------------------- | -------- | ------- |
| `--force` | `-f`  | Force deletion without confirmation | No       | `false` |

<!-- politty:options:delete:end -->
