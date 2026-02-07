<!-- politty:command::start -->

# file-cli

File operations CLI with examples

**Usage**

```
file-cli [command]
```

**Commands**

| Command             | Description           |
| ------------------- | --------------------- |
| [`read`](#read)     | Read file contents    |
| [`write`](#write)   | Write content to file |
| [`check`](#check)   | Check if file exists  |
| [`delete`](#delete) | Delete a file         |

<!-- politty:command::end -->
<!-- politty:command:read:start -->

## read

Read file contents

**Usage**

```
file-cli read [options] <file>
```

**Arguments**

| Argument | Description       | Required |
| -------- | ----------------- | -------- |
| `file`   | File path to read | Yes      |

**Options**

| Option              | Alias | Description   | Default  |
| ------------------- | ----- | ------------- | -------- |
| `--format <FORMAT>` | `-f`  | Output format | `"text"` |

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

<!-- politty:command:read:end -->
<!-- politty:command:write:start -->

## write

Write content to file

**Usage**

```
file-cli write [options] <file> <content>
```

**Arguments**

| Argument  | Description        | Required |
| --------- | ------------------ | -------- |
| `file`    | File path to write | Yes      |
| `content` | Content to write   | Yes      |

**Options**

| Option     | Alias | Description                           | Default |
| ---------- | ----- | ------------------------------------- | ------- |
| `--append` | `-a`  | Append to file instead of overwriting | `false` |

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

<!-- politty:command:write:end -->
<!-- politty:command:check:start -->

## check

Check if file exists

**Usage**

```
file-cli check <file>
```

**Arguments**

| Argument | Description        | Required |
| -------- | ------------------ | -------- |
| `file`   | File path to check | Yes      |

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

<!-- politty:command:check:end -->

<!-- politty:command:delete:start -->

## delete

Delete a file

**Usage**

```
file-cli delete [options] <file>
```

**Arguments**

| Argument | Description         | Required |
| -------- | ------------------- | -------- |
| `file`   | File path to delete | Yes      |

**Options**

| Option    | Alias | Description                         | Default |
| --------- | ----- | ----------------------------------- | ------- |
| `--force` | `-f`  | Force deletion without confirmation | `false` |

<!-- politty:command:delete:end -->
