# Static Website Commands

Commands for deploying and managing static websites.

<!-- politty:command:staticwebsite:start -->

## staticwebsite

Manage static websites

**Usage**

```
tailor-sdk staticwebsite [command]
```

**Commands**

| Command                                         | Description                |
| ----------------------------------------------- | -------------------------- |
| [`staticwebsite deploy`](#staticwebsite-deploy) | Deploy a static website    |
| [`staticwebsite list`](#staticwebsite-list)     | List all static websites   |
| [`staticwebsite get`](#staticwebsite-get)       | Get static website details |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

Deploy and manage static websites on Tailor Platform.

<!-- politty:command:staticwebsite:end -->
<!-- politty:command:staticwebsite deploy:start -->

### staticwebsite deploy

Deploy a static website

**Usage**

```
tailor-sdk staticwebsite deploy [options] <name> <directory>
```

**Arguments**

| Argument    | Description                       | Required |
| ----------- | --------------------------------- | -------- |
| `name`      | Website name                      | Yes      |
| `directory` | Directory containing static files | Yes      |

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

**Notes**

Deploys all files from the specified directory.
MIME types are automatically detected from file extensions.

<!-- politty:command:staticwebsite deploy:end -->
<!-- politty:command:staticwebsite get:start -->

### staticwebsite get

Get static website details

**Usage**

```
tailor-sdk staticwebsite get [options] <name>
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Website name | Yes      |

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

<!-- politty:command:staticwebsite get:end -->
<!-- politty:command:staticwebsite list:start -->

### staticwebsite list

List all static websites

**Usage**

```
tailor-sdk staticwebsite list [options]
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

<!-- politty:command:staticwebsite list:end -->
