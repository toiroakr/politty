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

---

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

---

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
READ_MOCK_CONTENT_FOR_config.json
```

**Read a text file**

```bash
$ data.txt -f text
READ_MOCK_CONTENT_FOR_data.txt
```

---

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
