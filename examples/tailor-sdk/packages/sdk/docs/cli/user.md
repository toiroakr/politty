# User Commands

Commands for managing users and personal access tokens.

<!-- politty:command:login:start -->

## login

Authenticate with Tailor Platform

**Usage**

```
tailor-sdk login
```

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

This command starts an OAuth2 authentication flow:

1. Opens your browser to the Tailor Platform login page
2. Waits for authentication to complete
3. Stores the access token locally

<!-- politty:command:login:end -->
<!-- politty:command:logout:start -->

## logout

End your Tailor Platform session

**Usage**

```
tailor-sdk logout
```

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

This invalidates your OAuth2 token and removes local credentials.

<!-- politty:command:logout:end -->
<!-- politty:command:user:start -->

## user

Manage Tailor Platform users

**Usage**

```
tailor-sdk user [command]
```

**Commands**

| Command                         | Description                              |
| ------------------------------- | ---------------------------------------- |
| [`user current`](#user-current) | Display the currently logged-in user     |
| [`user list`](#user-list)       | List all authenticated users             |
| [`user switch`](#user-switch)   | Switch to a different authenticated user |
| [`user pat`](#user-pat)         | Manage personal access tokens            |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

User management commands allow you to:

- View the currently logged-in user
- List all authenticated users
- Switch between authenticated accounts
- Manage personal access tokens

<!-- politty:command:user:end -->
<!-- politty:command:user current:start -->

### user current

Display the currently logged-in user

**Usage**

```
tailor-sdk user current [options]
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

<!-- politty:command:user current:end -->
<!-- politty:command:user list:start -->

### user list

List all authenticated users

**Usage**

```
tailor-sdk user list [options]
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

<!-- politty:command:user list:end -->
<!-- politty:command:user pat:start -->

### user pat

Manage personal access tokens

**Usage**

```
tailor-sdk user pat [command]
```

**Commands**

| Command                               | Description                        |
| ------------------------------------- | ---------------------------------- |
| [`user pat create`](#user-pat-create) | Create a new personal access token |
| [`user pat delete`](#user-pat-delete) | Delete a personal access token     |
| [`user pat list`](#user-pat-list)     | List all personal access tokens    |
| [`user pat update`](#user-pat-update) | Update a personal access token     |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

Personal access tokens (PATs) allow programmatic access to Tailor Platform APIs.
Use these tokens for CI/CD pipelines, scripts, and integrations.

<!-- politty:command:user pat:end -->
<!-- politty:command:user pat create:start -->

#### user pat create

Create a new personal access token

**Usage**

```
tailor-sdk user pat create [options] <name>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Token name  | Yes      |

**Options**

| Option    | Alias | Description                          | Default |
| --------- | ----- | ------------------------------------ | ------- |
| `--write` | `-W`  | Grant write permissions to the token | `false` |
| `--json`  | `-j`  | Output in JSON format                | `false` |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

<!-- politty:command:user pat create:end -->
<!-- politty:command:user pat delete:start -->

#### user pat delete

Delete a personal access token

**Usage**

```
tailor-sdk user pat delete [options] <name>
```

**Arguments**

| Argument | Description          | Required |
| -------- | -------------------- | -------- |
| `name`   | Token name to delete | Yes      |

**Options**

| Option  | Alias | Description               | Default |
| ------- | ----- | ------------------------- | ------- |
| `--yes` | `-y`  | Skip confirmation prompts | `false` |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

<!-- politty:command:user pat delete:end -->
<!-- politty:command:user pat list:start -->

#### user pat list

List all personal access tokens

**Usage**

```
tailor-sdk user pat list [options]
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

<!-- politty:command:user pat list:end -->
<!-- politty:command:user pat update:start -->

#### user pat update

Update a personal access token

**Usage**

```
tailor-sdk user pat update [options] <name>
```

**Arguments**

| Argument | Description          | Required |
| -------- | -------------------- | -------- |
| `name`   | Token name to update | Yes      |

**Options**

| Option    | Alias | Description             | Default |
| --------- | ----- | ----------------------- | ------- |
| `--write` | `-W`  | Update write permission | -       |
| `--json`  | `-j`  | Output in JSON format   | `false` |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:user pat update:end -->
<!-- politty:command:user switch:start -->

### user switch

Switch to a different authenticated user

**Usage**

```
tailor-sdk user switch <user>
```

**Arguments**

| Argument | Description             | Required |
| -------- | ----------------------- | -------- |
| `user`   | User email to switch to | Yes      |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:user switch:end -->
