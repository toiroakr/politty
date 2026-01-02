<!-- politty:command::start -->

# file-cli

File operations CLI with examples

## Usage

```
file-cli [command]
```

## Commands

| Command           | Description           |
| ----------------- | --------------------- |
| [`read`](#read)   | Read file contents    |
| [`write`](#write) | Write content to file |
| [`check`](#check) | Check if file exists  |

<!-- politty:command::end -->
<!-- politty:command:read:start -->

# read

Read file contents

## Usage

```
file-cli read [options] <file>
```

## Arguments

| Argument | Description       | Required |
| -------- | ----------------- | -------- |
| `file`   | File path to read | Yes      |

## Options

| Option              | Alias | Description   | Default  |
| ------------------- | ----- | ------------- | -------- |
| `--format <FORMAT>` | `-f`  | Output format | `"text"` |

## Examples

**Read a JSON config file**

```bash
$ config.json
{
  "name": "my-app",
  "version": "1.0.0"
}
```

**Read a text file**

```bash
$ data.txt -f text
Hello from data.txt
```

<!-- politty:command:read:end -->
<!-- politty:command:write:start -->

# write

Write content to file

## Usage

```
file-cli write [options] <file> <content>
```

## Arguments

| Argument  | Description        | Required |
| --------- | ------------------ | -------- |
| `file`    | File path to write | Yes      |
| `content` | Content to write   | Yes      |

## Options

| Option     | Alias | Description                           | Default |
| ---------- | ----- | ------------------------------------- | ------- |
| `--append` | `-a`  | Append to file instead of overwriting | `false` |

## Examples

**Write text to a file**

```bash
$ output.txt "Hello, World!"
Successfully written to output.txt
```

**Append text to a file**

```bash
$ log.txt "New entry" --append
Successfully appended to log.txt
```

<!-- politty:command:write:end -->
<!-- politty:command:check:start -->

# check

Check if file exists

## Usage

```
file-cli check <file>
```

## Arguments

| Argument | Description        | Required |
| -------- | ------------------ | -------- |
| `file`   | File path to check | Yes      |

## Examples

**Check if config file exists**

```bash
$ config.json
File exists: config.json
```

**Check non-existent file**

```bash
$ missing.txt
File not found: missing.txt
```

<!-- politty:command:check:end -->
