<!-- politty:command:init:heading:start -->

## init

<!-- politty:command:init:heading:end -->

<!-- politty:command:init:description:start -->

Initialize a new project

<!-- politty:command:init:description:end -->

<!-- politty:command:init:usage:start -->

**Usage**

```
project-cli init [options] <name>
```

<!-- politty:command:init:usage:end -->

<!-- politty:command:init:arguments:start -->

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Project name | Yes      |

<!-- politty:command:init:arguments:end -->

<!-- politty:command:init:options:start -->

**Options**

| Option                  | Alias | Description             | Required | Default     |
| ----------------------- | ----- | ----------------------- | -------- | ----------- |
| `--template <TEMPLATE>` | `-t`  | Project template to use | No       | `"default"` |

<!-- politty:command:init:options:end -->

<!-- politty:command:build:heading:start -->

## build

<!-- politty:command:build:heading:end -->

<!-- politty:command:build:description:start -->

Build the project

<!-- politty:command:build:description:end -->

<!-- politty:command:build:usage:start -->

**Usage**

```
project-cli build [options]
```

<!-- politty:command:build:usage:end -->

<!-- politty:command:build:options:start -->

**Options**

| Option    | Alias | Description       | Required | Default |
| --------- | ----- | ----------------- | -------- | ------- |
| `--watch` | `-w`  | Watch for changes | No       | `false` |

<!-- politty:command:build:options:end -->

<!-- politty:command:deploy:heading:start -->

## deploy

<!-- politty:command:deploy:heading:end -->

<!-- politty:command:deploy:description:start -->

Deploy the project

<!-- politty:command:deploy:description:end -->

<!-- politty:command:deploy:usage:start -->

**Usage**

```
project-cli deploy [options]
```

<!-- politty:command:deploy:usage:end -->

<!-- politty:command:deploy:options:start -->

**Options**

| Option    | Alias | Description                           | Required | Default |
| --------- | ----- | ------------------------------------- | -------- | ------- |
| `--force` | `-f`  | Force deployment without confirmation | No       | `false` |

<!-- politty:command:deploy:options:end -->
