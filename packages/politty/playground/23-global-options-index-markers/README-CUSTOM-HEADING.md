<!-- politty:command:init:start -->

## init

Initialize a new project

**Usage**

```
project-cli init [options] <name>
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Project name | Yes      |

**Options**

| Option                  | Alias | Description             | Required | Default     |
| ----------------------- | ----- | ----------------------- | -------- | ----------- |
| `--template <TEMPLATE>` | `-t`  | Project template to use | No       | `"default"` |

See [Global Options](REFERENCE-CUSTOM-HEADING.md#global-options) for options available to all commands.

<!-- politty:command:init:end -->

<!-- politty:command:build:start -->

## build

Build the project

**Usage**

```
project-cli build [options]
```

**Options**

| Option    | Alias | Description       | Required | Default |
| --------- | ----- | ----------------- | -------- | ------- |
| `--watch` | `-w`  | Watch for changes | No       | `false` |

See [Global Options](REFERENCE-CUSTOM-HEADING.md#global-options) for options available to all commands.

<!-- politty:command:build:end -->

<!-- politty:command:deploy:start -->

## deploy

Deploy the project

**Usage**

```
project-cli deploy [options]
```

**Options**

| Option    | Alias | Description                           | Required | Default |
| --------- | ----- | ------------------------------------- | -------- | ------- |
| `--force` | `-f`  | Force deployment without confirmation | No       | `false` |

See [Global Options](REFERENCE-CUSTOM-HEADING.md#global-options) for options available to all commands.

<!-- politty:command:deploy:end -->
