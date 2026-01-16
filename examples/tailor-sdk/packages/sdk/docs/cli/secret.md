# Secret Management Commands

Commands for managing secrets and vaults.

<!-- politty:command:secret:start -->

## secret

Manage secrets and vaults

**Usage**

```
tailor-sdk secret [command]
```

**Commands**

| Command                           | Description                 |
| --------------------------------- | --------------------------- |
| [`secret vault`](#secret-vault)   | Manage secret vaults        |
| [`secret create`](#secret-create) | Create a new secret         |
| [`secret list`](#secret-list)     | List all secrets in a vault |
| [`secret update`](#secret-update) | Update an existing secret   |
| [`secret delete`](#secret-delete) | Delete a secret             |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

Secrets are securely stored key-value pairs.
Secrets are organized in vaults within a workspace.

<!-- politty:command:secret:end -->
<!-- politty:command:secret create:start -->

### secret create

Create a new secret

**Usage**

```
tailor-sdk secret create [options]
```

**Options**

| Option                | Alias | Description           | Default | Env                   |
| --------------------- | ----- | --------------------- | ------- | --------------------- |
| `--vault <vault>`     | `-V`  | Vault name            | -       | -                     |
| `--name <name>`       | `-n`  | Secret name           | -       | -                     |
| `--value <value>`     | `-v`  | Secret value          | -       | -                     |
| `--workspace-id <id>` | `-w`  | Target workspace ID   | -       | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`    | `-p`  | Profile to use        | -       | -                     |
| `--json`              | `-j`  | Output in JSON format | `false` | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:secret create:end -->
<!-- politty:command:secret delete:start -->

### secret delete

Delete a secret

**Usage**

```
tailor-sdk secret delete [options]
```

**Options**

| Option                | Alias | Description               | Default | Env                   |
| --------------------- | ----- | ------------------------- | ------- | --------------------- |
| `--vault <vault>`     | `-V`  | Vault name                | -       | -                     |
| `--name <name>`       | `-n`  | Secret name to delete     | -       | -                     |
| `--yes`               | `-y`  | Skip confirmation prompts | `false` | -                     |
| `--workspace-id <id>` | `-w`  | Target workspace ID       | -       | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`    | `-p`  | Profile to use            | -       | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:secret delete:end -->
<!-- politty:command:secret list:start -->

### secret list

List all secrets in a vault

**Usage**

```
tailor-sdk secret list [options]
```

**Options**

| Option                | Alias | Description           | Default | Env                   |
| --------------------- | ----- | --------------------- | ------- | --------------------- |
| `--vault <vault>`     | `-V`  | Vault name            | -       | -                     |
| `--workspace-id <id>` | `-w`  | Target workspace ID   | -       | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`    | `-p`  | Profile to use        | -       | -                     |
| `--json`              | `-j`  | Output in JSON format | `false` | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:secret list:end -->
<!-- politty:command:secret update:start -->

### secret update

Update an existing secret

**Usage**

```
tailor-sdk secret update [options]
```

**Options**

| Option                | Alias | Description           | Default | Env                   |
| --------------------- | ----- | --------------------- | ------- | --------------------- |
| `--vault <vault>`     | `-V`  | Vault name            | -       | -                     |
| `--name <name>`       | `-n`  | Secret name           | -       | -                     |
| `--value <value>`     | `-v`  | New secret value      | -       | -                     |
| `--workspace-id <id>` | `-w`  | Target workspace ID   | -       | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`    | `-p`  | Profile to use        | -       | -                     |
| `--json`              | `-j`  | Output in JSON format | `false` | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:secret update:end -->
<!-- politty:command:secret vault:start -->

### secret vault

Manage secret vaults

**Usage**

```
tailor-sdk secret vault [command]
```

**Commands**

| Command                                       | Description               |
| --------------------------------------------- | ------------------------- |
| [`secret vault create`](#secret-vault-create) | Create a new secret vault |
| [`secret vault list`](#secret-vault-list)     | List all secret vaults    |
| [`secret vault delete`](#secret-vault-delete) | Delete a secret vault     |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

Vaults are containers for organizing secrets within a workspace.

<!-- politty:command:secret vault:end -->
<!-- politty:command:secret vault create:start -->

#### secret vault create

Create a new secret vault

**Usage**

```
tailor-sdk secret vault create [options] <name>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Vault name  | Yes      |

**Options**

| Option                | Alias | Description           | Default | Env                   |
| --------------------- | ----- | --------------------- | ------- | --------------------- |
| `--workspace-id <id>` | `-w`  | Target workspace ID   | -       | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`    | `-p`  | Profile to use        | -       | -                     |
| `--json`              | `-j`  | Output in JSON format | `false` | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:secret vault create:end -->
<!-- politty:command:secret vault delete:start -->

#### secret vault delete

Delete a secret vault

**Usage**

```
tailor-sdk secret vault delete [options] <name>
```

**Arguments**

| Argument | Description          | Required |
| -------- | -------------------- | -------- |
| `name`   | Vault name to delete | Yes      |

**Options**

| Option                | Alias | Description               | Default | Env                   |
| --------------------- | ----- | ------------------------- | ------- | --------------------- |
| `--yes`               | `-y`  | Skip confirmation prompts | `false` | -                     |
| `--workspace-id <id>` | `-w`  | Target workspace ID       | -       | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`    | `-p`  | Profile to use            | -       | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:secret vault delete:end -->
<!-- politty:command:secret vault list:start -->

#### secret vault list

List all secret vaults

**Usage**

```
tailor-sdk secret vault list [options]
```

**Options**

| Option                | Alias | Description           | Default | Env                   |
| --------------------- | ----- | --------------------- | ------- | --------------------- |
| `--workspace-id <id>` | `-w`  | Target workspace ID   | -       | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`    | `-p`  | Profile to use        | -       | -                     |
| `--json`              | `-j`  | Output in JSON format | `false` | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:secret vault list:end -->
