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

<!-- politty:command:deploy:end -->
