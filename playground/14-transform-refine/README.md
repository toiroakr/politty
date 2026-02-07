<!-- politty:command::start -->

# validation-demo

Demo of transform/refine

**Usage**

```
validation-demo [command]
```

**Commands**

| Command                   | Description                                |
| ------------------------- | ------------------------------------------ |
| [`transform`](#transform) | Example using transform for conversion     |
| [`refine`](#refine)       | Example using refine for custom validation |

<!-- politty:command::end -->
<!-- politty:command:refine:start -->

## refine

Example using refine for custom validation

**Usage**

```
validation-demo refine <input> <output>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `input`  | Input file  | Yes      |
| `output` | Output file | Yes      |

<!-- politty:command:refine:end -->
<!-- politty:command:transform:start -->

## transform

Example using transform for conversion

**Usage**

```
validation-demo transform [options] <name>
```

**Arguments**

| Argument | Description                           | Required |
| -------- | ------------------------------------- | -------- |
| `name`   | Name (will be converted to uppercase) | Yes      |

**Options**

| Option          | Alias | Description          | Required | Default |
| --------------- | ----- | -------------------- | -------- | ------- |
| `--tags <TAGS>` | `-t`  | Comma-separated tags | Yes      | -       |

<!-- politty:command:transform:end -->
