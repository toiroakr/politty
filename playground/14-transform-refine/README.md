<!-- politty:heading::start -->

# validation-demo

<!-- politty:heading::end -->

<!-- politty:description::start -->

Demo of transform/refine

<!-- politty:description::end -->

<!-- politty:usage::start -->

**Usage**

```
validation-demo [command]
```

<!-- politty:usage::end -->

<!-- politty:subcommands::start -->

**Commands**

| Command                   | Description                                |
| ------------------------- | ------------------------------------------ |
| [`transform`](#transform) | Example using transform for conversion     |
| [`refine`](#refine)       | Example using refine for custom validation |

<!-- politty:subcommands::end -->

<!-- politty:heading:refine:start -->

## refine

<!-- politty:heading:refine:end -->

<!-- politty:description:refine:start -->

Example using refine for custom validation

<!-- politty:description:refine:end -->

<!-- politty:usage:refine:start -->

**Usage**

```
validation-demo refine <input> <output>
```

<!-- politty:usage:refine:end -->

<!-- politty:arguments:refine:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `input`  | Input file  | Yes      |
| `output` | Output file | Yes      |

<!-- politty:arguments:refine:end -->

<!-- politty:heading:transform:start -->

## transform

<!-- politty:heading:transform:end -->

<!-- politty:description:transform:start -->

Example using transform for conversion

<!-- politty:description:transform:end -->

<!-- politty:usage:transform:start -->

**Usage**

```
validation-demo transform [options] <name>
```

<!-- politty:usage:transform:end -->

<!-- politty:arguments:transform:start -->

**Arguments**

| Argument | Description                           | Required |
| -------- | ------------------------------------- | -------- |
| `name`   | Name (will be converted to uppercase) | Yes      |

<!-- politty:arguments:transform:end -->

<!-- politty:options:transform:start -->

**Options**

| Option          | Alias | Description          | Required | Default |
| --------------- | ----- | -------------------- | -------- | ------- |
| `--tags <TAGS>` | `-t`  | Comma-separated tags | Yes      | -       |

<!-- politty:options:transform:end -->
