# Authentication Resource Commands

Commands for managing authentication resources like machine users and OAuth2 clients.

<!-- politty:command:machineuser:start -->

## machineuser

Manage machine users for authentication

**Usage**

```
tailor-sdk machineuser [command]
```

**Commands**

| Command                                   | Description                    |
| ----------------------------------------- | ------------------------------ |
| [`machineuser list`](#machineuser-list)   | List all machine users         |
| [`machineuser token`](#machineuser-token) | Get a token for a machine user |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

Machine users are service accounts for programmatic access.

<!-- politty:command:machineuser:end -->
<!-- politty:command:machineuser list:start -->

### machineuser list

List all machine users

**Usage**

```
tailor-sdk machineuser list [options]
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

<!-- politty:command:machineuser list:end -->
<!-- politty:command:machineuser token:start -->

### machineuser token

Get a token for a machine user

**Usage**

```
tailor-sdk machineuser token [options] <name>
```

**Arguments**

| Argument | Description       | Required |
| -------- | ----------------- | -------- |
| `name`   | Machine user name | Yes      |

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

<!-- politty:command:machineuser token:end -->
<!-- politty:command:oauth2client:start -->

## oauth2client

Manage OAuth2 clients for authentication

**Usage**

```
tailor-sdk oauth2client [command]
```

**Commands**

| Command                                   | Description               |
| ----------------------------------------- | ------------------------- |
| [`oauth2client list`](#oauth2client-list) | List all OAuth2 clients   |
| [`oauth2client get`](#oauth2client-get)   | Get OAuth2 client details |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

OAuth2 clients enable OAuth2 authentication flows for your applications.

<!-- politty:command:oauth2client:end -->
<!-- politty:command:oauth2client get:start -->

### oauth2client get

Get OAuth2 client details

**Usage**

```
tailor-sdk oauth2client get [options] <name>
```

**Arguments**

| Argument | Description        | Required |
| -------- | ------------------ | -------- |
| `name`   | OAuth2 client name | Yes      |

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

<!-- politty:command:oauth2client get:end -->
<!-- politty:command:oauth2client list:start -->

### oauth2client list

List all OAuth2 clients

**Usage**

```
tailor-sdk oauth2client list [options]
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

<!-- politty:command:oauth2client list:end -->
