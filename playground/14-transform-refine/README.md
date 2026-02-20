<!-- politty:command::heading:start -->

# validation-demo

<!-- politty:command::heading:end -->

<!-- politty:command::description:start -->

Demo of transform/refine

<!-- politty:command::description:end -->

<!-- politty:command::usage:start -->

**Usage**

```
validation-demo [command]
```

<!-- politty:command::usage:end -->

<!-- politty:command::subcommands:start -->

**Commands**

| Command                   | Description                                |
| ------------------------- | ------------------------------------------ |
| [`transform`](#transform) | Example using transform for conversion     |
| [`refine`](#refine)       | Example using refine for custom validation |

<!-- politty:command::subcommands:end -->

<!-- politty:command:refine:heading:start -->

## refine

<!-- politty:command:refine:heading:end -->

<!-- politty:command:refine:description:start -->

Example using refine for custom validation

<!-- politty:command:refine:description:end -->

<!-- politty:command:refine:usage:start -->

**Usage**

```
validation-demo refine <input> <output>
```

<!-- politty:command:refine:usage:end -->

<!-- politty:command:refine:arguments:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `input`  | Input file  | Yes      |
| `output` | Output file | Yes      |

<!-- politty:command:refine:arguments:end -->

<!-- politty:command:transform:heading:start -->

## transform

<!-- politty:command:transform:heading:end -->

<!-- politty:command:transform:description:start -->

Example using transform for conversion

<!-- politty:command:transform:description:end -->

<!-- politty:command:transform:usage:start -->

**Usage**

```
validation-demo transform [options] <name>
```

<!-- politty:command:transform:usage:end -->

<!-- politty:command:transform:arguments:start -->

**Arguments**

| Argument | Description                           | Required |
| -------- | ------------------------------------- | -------- |
| `name`   | Name (will be converted to uppercase) | Yes      |

<!-- politty:command:transform:arguments:end -->

<!-- politty:command:transform:options:start -->

**Options**

| Option          | Alias | Description          | Required | Default |
| --------------- | ----- | -------------------- | -------- | ------- |
| `--tags <TAGS>` | `-t`  | Comma-separated tags | Yes      | -       |

<!-- politty:command:transform:options:end -->
