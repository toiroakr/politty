# Workspace and Profile Commands

Commands for managing workspaces and profiles.

<!-- politty:command:workspace:start -->

## workspace

Manage Tailor Platform workspaces

**Usage**

```
tailor-sdk workspace [command]
```

**Commands**

| Command                                 | Description            |
| --------------------------------------- | ---------------------- |
| [`workspace create`](#workspace-create) | Create a new workspace |
| [`workspace list`](#workspace-list)     | List all workspaces    |
| [`workspace delete`](#workspace-delete) | Delete a workspace     |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

Workspaces are isolated environments for your applications.
Each workspace has its own resources, configurations, and permissions.

<!-- politty:command:workspace:end -->
<!-- politty:command:workspace create:start -->

### workspace create

Create a new workspace

**Usage**

```
tailor-sdk workspace create [options]
```

**Options**

| Option                     | Alias | Description                                              | Default |
| -------------------------- | ----- | -------------------------------------------------------- | ------- |
| `--name <name>`            | `-n`  | Workspace name (3-30 chars, lowercase, numbers, hyphens) | -       |
| `--region <region>`        | `-r`  | Region for the workspace (e.g., us-west, asia-northeast) | -       |
| `--delete-protection`      | `-d`  | Enable delete protection                                 | `false` |
| `--organization-id <uuid>` | `-o`  | Organization ID (UUID)                                   | -       |
| `--folder-id <uuid>`       | `-f`  | Folder ID (UUID)                                         | -       |
| `--json`                   | `-j`  | Output in JSON format                                    | `false` |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

<!-- politty:command:workspace create:end -->
<!-- politty:command:workspace delete:start -->

### workspace delete

Delete a workspace

**Usage**

```
tailor-sdk workspace delete [options] <name>
```

**Arguments**

| Argument | Description              | Required |
| -------- | ------------------------ | -------- |
| `name`   | Workspace name to delete | Yes      |

**Options**

| Option   | Alias | Description               | Default |
| -------- | ----- | ------------------------- | ------- |
| `--yes`  | `-y`  | Skip confirmation prompts | `false` |
| `--json` | `-j`  | Output in JSON format     | `false` |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

<!-- politty:command:workspace delete:end -->
<!-- politty:command:workspace list:start -->

### workspace list

List all workspaces

**Usage**

```
tailor-sdk workspace list [options]
```

**Options**

| Option   | Alias | Description           | Default |
| -------- | ----- | --------------------- | ------- |
| `--json` | `-j`  | Output in JSON format | `false` |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:workspace list:end -->
<!-- politty:command:profile:start -->

## profile

Manage profiles for workspace and user configurations

**Usage**

```
tailor-sdk profile [command]
```

**Commands**

| Command                             | Description                |
| ----------------------------------- | -------------------------- |
| [`profile create`](#profile-create) | Create a new profile       |
| [`profile list`](#profile-list)     | List all profiles          |
| [`profile update`](#profile-update) | Update an existing profile |
| [`profile delete`](#profile-delete) | Delete a profile           |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

Profiles store workspace and user configurations for easy switching.
Use profiles to quickly switch between different environments.

<!-- politty:command:profile:end -->
<!-- politty:command:profile create:start -->

### profile create

Create a new profile

**Usage**

```
tailor-sdk profile create [options]
```

**Options**

| Option                | Alias | Description                                | Default |
| --------------------- | ----- | ------------------------------------------ | ------- |
| `--name <name>`       | `-n`  | Profile name                               | -       |
| `--workspace-id <id>` | `-w`  | Workspace ID to associate with the profile | -       |
| `--user <email>`      | `-u`  | User email to associate with the profile   | -       |
| `--json`              | `-j`  | Output in JSON format                      | `false` |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:profile create:end -->
<!-- politty:command:profile delete:start -->

### profile delete

Delete a profile

**Usage**

```
tailor-sdk profile delete [options] <name>
```

**Arguments**

| Argument | Description            | Required |
| -------- | ---------------------- | -------- |
| `name`   | Profile name to delete | Yes      |

**Options**

| Option  | Alias | Description               | Default |
| ------- | ----- | ------------------------- | ------- |
| `--yes` | `-y`  | Skip confirmation prompts | `false` |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:profile delete:end -->
<!-- politty:command:profile list:start -->

### profile list

List all profiles

**Usage**

```
tailor-sdk profile list [options]
```

**Options**

| Option   | Alias | Description           | Default |
| -------- | ----- | --------------------- | ------- |
| `--json` | `-j`  | Output in JSON format | `false` |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:profile list:end -->
<!-- politty:command:profile update:start -->

### profile update

Update an existing profile

**Usage**

```
tailor-sdk profile update [options] <name>
```

**Arguments**

| Argument | Description            | Required |
| -------- | ---------------------- | -------- |
| `name`   | Profile name to update | Yes      |

**Options**

| Option                | Alias | Description           | Default |
| --------------------- | ----- | --------------------- | ------- |
| `--workspace-id <id>` | `-w`  | New workspace ID      | -       |
| `--user <email>`      | `-u`  | New user email        | -       |
| `--json`              | `-j`  | Output in JSON format | `false` |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:profile update:end -->
