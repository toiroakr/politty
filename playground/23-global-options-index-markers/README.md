<!-- politty:heading:init:start -->

## init

<!-- politty:heading:init:end -->

<!-- politty:description:init:start -->

Initialize a new project

<!-- politty:description:init:end -->

<!-- politty:usage:init:start -->

**Usage**

```
project-cli init [options] <name>
```

<!-- politty:usage:init:end -->

<!-- politty:arguments:init:start -->

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Project name | Yes      |

<!-- politty:arguments:init:end -->

<!-- politty:options:init:start -->

**Options**

| Option                  | Alias | Description             | Required | Default     |
| ----------------------- | ----- | ----------------------- | -------- | ----------- |
| `--template <TEMPLATE>` | `-t`  | Project template to use | No       | `"default"` |

<!-- politty:options:init:end -->

<!-- politty:heading:build:start -->

## build

<!-- politty:heading:build:end -->

<!-- politty:description:build:start -->

Build the project

<!-- politty:description:build:end -->

<!-- politty:usage:build:start -->

**Usage**

```
project-cli build [options]
```

<!-- politty:usage:build:end -->

<!-- politty:options:build:start -->

**Options**

| Option    | Alias | Description       | Required | Default |
| --------- | ----- | ----------------- | -------- | ------- |
| `--watch` | `-w`  | Watch for changes | No       | `false` |

<!-- politty:options:build:end -->

<!-- politty:heading:deploy:start -->

## deploy

<!-- politty:heading:deploy:end -->

<!-- politty:description:deploy:start -->

Deploy the project

<!-- politty:description:deploy:end -->

<!-- politty:usage:deploy:start -->

**Usage**

```
project-cli deploy [options]
```

<!-- politty:usage:deploy:end -->

<!-- politty:options:deploy:start -->

**Options**

| Option    | Alias | Description                           | Required | Default |
| --------- | ----- | ------------------------------------- | -------- | ------- |
| `--force` | `-f`  | Force deployment without confirmation | No       | `false` |

<!-- politty:options:deploy:end -->
