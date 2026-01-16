# Application Commands

Commands for managing Tailor Platform applications.

<!-- politty:command:init:start -->

## init

Initialize a new Tailor Platform project

**Usage**

```
tailor-sdk init [options] [name]
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Project name | No       |

**Options**

| Option                  | Alias | Description             | Default |
| ----------------------- | ----- | ----------------------- | ------- |
| `--template <template>` | `-t`  | Project template to use | -       |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

**Notes**

Available templates:

- hello-world (default)
- inventory-management
- testing
- multi-application

<!-- politty:command:init:end -->
<!-- politty:command:apply:start -->

## apply

Deploy your application configuration to a workspace

**Usage**

```
tailor-sdk apply [options]
```

**Options**

| Option                | Alias | Description                                 | Default              | Env                   |
| --------------------- | ----- | ------------------------------------------- | -------------------- | --------------------- |
| `--workspace-id <id>` | `-w`  | Target workspace ID                         | -                    | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`    | `-p`  | Profile to use                              | -                    | -                     |
| `--config <path>`     | `-c`  | Path to SDK configuration file              | `"tailor.config.ts"` | -                     |
| `--dry-run`           | -     | Show deployment plan without making changes | `false`              | -                     |
| `--yes`               | `-y`  | Skip confirmation prompts                   | `false`              | -                     |
| `--verbose`           | -     | Enable verbose output                       | `false`              | -                     |
| `--env-file <path>`   | `-e`  | Path to environment file                    | -                    | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

**Notes**

The apply command performs an 8-stage deployment:

1. Load and validate configuration
2. Generate types and build workflows
3. Plan changes for all services
4. Check for conflicts and unmanaged resources
5. Update TailorDB, IdP, Auth, Pipeline, Executor, Workflow
6. Update Application metadata
7. Manage dependent services
8. Cleanup

<!-- politty:command:apply:end -->
<!-- politty:command:remove:start -->

## remove

Remove application-related resources from a workspace

**Usage**

```
tailor-sdk remove [options]
```

**Options**

| Option                | Alias | Description                    | Default              | Env                   |
| --------------------- | ----- | ------------------------------ | -------------------- | --------------------- |
| `--workspace-id <id>` | `-w`  | Target workspace ID            | -                    | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`    | `-p`  | Profile to use                 | -                    | -                     |
| `--config <path>`     | `-c`  | Path to SDK configuration file | `"tailor.config.ts"` | -                     |
| `--yes`               | `-y`  | Skip confirmation prompts      | `false`              | -                     |
| `--verbose`           | -     | Enable verbose output          | `false`              | -                     |
| `--env-file <path>`   | `-e`  | Path to environment file       | -                    | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

<!-- politty:command:remove:end -->
<!-- politty:command:show:start -->

## show

Display deployment information

**Usage**

```
tailor-sdk show [options]
```

**Options**

| Option                | Alias | Description                    | Default              | Env                   |
| --------------------- | ----- | ------------------------------ | -------------------- | --------------------- |
| `--workspace-id <id>` | `-w`  | Target workspace ID            | -                    | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`    | `-p`  | Profile to use                 | -                    | -                     |
| `--config <path>`     | `-c`  | Path to SDK configuration file | `"tailor.config.ts"` | -                     |
| `--json`              | `-j`  | Output in JSON format          | `false`              | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

<!-- politty:command:show:end -->
<!-- politty:command:generate:start -->

## generate

Generate types and files from your application configuration

**Usage**

```
tailor-sdk generate [options]
```

**Options**

| Option            | Alias | Description                      | Default              |
| ----------------- | ----- | -------------------------------- | -------------------- |
| `--config <path>` | `-c`  | Path to SDK configuration file   | `"tailor.config.ts"` |
| `--watch`         | `-w`  | Watch for changes and regenerate | `false`              |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

**Notes**

This command generates TypeScript types based on your TailorDB schema.

<!-- politty:command:generate:end -->
