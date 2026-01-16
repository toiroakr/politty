# CLI Reference

This page provides a comprehensive reference for all Tailor Platform SDK CLI commands.

## Installation

```bash
npm install -g @tailor-platform/sdk
```

## Global Options

The following options are available for most commands:

| Option           | Alias | Description               |
| ---------------- | ----- | ------------------------- |
| `--workspace-id` | `-w`  | Target workspace ID       |
| `--profile`      | `-p`  | Profile to use            |
| `--json`         | `-j`  | Output in JSON format     |
| `--yes`          | `-y`  | Skip confirmation prompts |
| `--verbose`      |       | Enable verbose output     |
| `--env-file`     | `-e`  | Path to environment file  |

## Environment Variables

| Variable                | Description                     |
| ----------------------- | ------------------------------- |
| `TAILOR_PLATFORM_TOKEN` | Access token for authentication |
| `TAILOR_WORKSPACE_ID`   | Default workspace ID            |

## Commands

<!-- politty:command::start -->

## tailor-sdk

Tailor Platform SDK CLI - Build and deploy applications on Tailor Platform

**Usage**

```
tailor-sdk [command]
```

**Commands**

| Command                                               | Description                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| [`login`](cli/user.md#login)                          | Authenticate with Tailor Platform                            |
| [`logout`](cli/user.md#logout)                        | End your Tailor Platform session                             |
| [`init`](cli/application.md#init)                     | Initialize a new Tailor Platform project                     |
| [`generate`](cli/application.md#generate)             | Generate types and files from your application configuration |
| [`apply`](cli/application.md#apply)                   | Deploy your application configuration to a workspace         |
| [`remove`](cli/application.md#remove)                 | Remove application-related resources from a workspace        |
| [`show`](cli/application.md#show)                     | Display deployment information                               |
| [`user`](cli/user.md#user)                            | Manage Tailor Platform users                                 |
| [`workspace`](cli/workspace.md#workspace)             | Manage Tailor Platform workspaces                            |
| [`profile`](cli/workspace.md#profile)                 | Manage profiles for workspace and user configurations        |
| [`workflow`](cli/workflow.md#workflow)                | Manage Tailor Platform workflows                             |
| [`secret`](cli/secret.md#secret)                      | Manage secrets and vaults                                    |
| [`staticwebsite`](cli/staticwebsite.md#staticwebsite) | Manage static websites                                       |
| [`machineuser`](cli/auth.md#machineuser)              | Manage machine users for authentication                      |
| [`oauth2client`](cli/auth.md#oauth2client)            | Manage OAuth2 clients for authentication                     |
| [`tailordb`](cli/tailordb.md#tailordb)                | Manage TailorDB operations                                   |
| [`api`](cli/api.md#api)                               | Execute API operations against Tailor Platform               |
| [`type-generator`](cli/api.md#type-generator)         | Generate TypeScript types from your schema                   |

**Notes**

For more information, visit https://docs.tailor.tech

Environment Variables:
TAILOR_PLATFORM_TOKEN Access token for authentication
TAILOR_WORKSPACE_ID Default workspace ID

<!-- politty:command::end -->
<!-- politty:command:api:start -->

### api

Execute API operations against Tailor Platform

**Usage**

```
tailor-sdk api [options]
```

**Options**

| Option                | Alias | Description                  | Default | Env                   |
| --------------------- | ----- | ---------------------------- | ------- | --------------------- |
| `--workspace-id <id>` | `-w`  | Target workspace ID          | -       | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`    | `-p`  | Profile to use               | -       | -                     |
| `--query <query>`     | `-q`  | GraphQL query to execute     | -       | -                     |
| `--variables <json>`  | `-v`  | JSON variables for the query | -       | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

<!-- politty:command:api:end -->
<!-- politty:command:apply:start -->

### apply

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
<!-- politty:command:generate:start -->

### generate

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
<!-- politty:command:init:start -->

### init

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
<!-- politty:command:login:start -->

### login

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

### logout

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
<!-- politty:command:machineuser:start -->

### machineuser

Manage machine users for authentication

**Usage**

```
tailor-sdk machineuser [command]
```

**Commands**

| Command                                              | Description                    |
| ---------------------------------------------------- | ------------------------------ |
| [`machineuser list`](cli/auth.md#machineuser-list)   | List all machine users         |
| [`machineuser token`](cli/auth.md#machineuser-token) | Get a token for a machine user |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

Machine users are service accounts for programmatic access.

<!-- politty:command:machineuser:end -->
<!-- politty:command:machineuser list:start -->

#### machineuser list

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

#### machineuser token

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

### oauth2client

Manage OAuth2 clients for authentication

**Usage**

```
tailor-sdk oauth2client [command]
```

**Commands**

| Command                                              | Description               |
| ---------------------------------------------------- | ------------------------- |
| [`oauth2client list`](cli/auth.md#oauth2client-list) | List all OAuth2 clients   |
| [`oauth2client get`](cli/auth.md#oauth2client-get)   | Get OAuth2 client details |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

OAuth2 clients enable OAuth2 authentication flows for your applications.

<!-- politty:command:oauth2client:end -->
<!-- politty:command:oauth2client get:start -->

#### oauth2client get

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

#### oauth2client list

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
<!-- politty:command:profile:start -->

### profile

Manage profiles for workspace and user configurations

**Usage**

```
tailor-sdk profile [command]
```

**Commands**

| Command                                             | Description                |
| --------------------------------------------------- | -------------------------- |
| [`profile create`](cli/workspace.md#profile-create) | Create a new profile       |
| [`profile list`](cli/workspace.md#profile-list)     | List all profiles          |
| [`profile update`](cli/workspace.md#profile-update) | Update an existing profile |
| [`profile delete`](cli/workspace.md#profile-delete) | Delete a profile           |

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

#### profile create

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

#### profile delete

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

#### profile list

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

#### profile update

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
<!-- politty:command:remove:start -->

### remove

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
<!-- politty:command:secret:start -->

### secret

Manage secrets and vaults

**Usage**

```
tailor-sdk secret [command]
```

**Commands**

| Command                                        | Description                 |
| ---------------------------------------------- | --------------------------- |
| [`secret vault`](cli/secret.md#secret-vault)   | Manage secret vaults        |
| [`secret create`](cli/secret.md#secret-create) | Create a new secret         |
| [`secret list`](cli/secret.md#secret-list)     | List all secrets in a vault |
| [`secret update`](cli/secret.md#secret-update) | Update an existing secret   |
| [`secret delete`](cli/secret.md#secret-delete) | Delete a secret             |

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

#### secret create

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

#### secret delete

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

#### secret list

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

#### secret update

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

#### secret vault

Manage secret vaults

**Usage**

```
tailor-sdk secret vault [command]
```

**Commands**

| Command                                                    | Description               |
| ---------------------------------------------------------- | ------------------------- |
| [`secret vault create`](cli/secret.md#secret-vault-create) | Create a new secret vault |
| [`secret vault list`](cli/secret.md#secret-vault-list)     | List all secret vaults    |
| [`secret vault delete`](cli/secret.md#secret-vault-delete) | Delete a secret vault     |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

Vaults are containers for organizing secrets within a workspace.

<!-- politty:command:secret vault:end -->
<!-- politty:command:secret vault create:start -->

##### secret vault create

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

##### secret vault delete

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

##### secret vault list

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
<!-- politty:command:show:start -->

### show

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
<!-- politty:command:staticwebsite:start -->

### staticwebsite

Manage static websites

**Usage**

```
tailor-sdk staticwebsite [command]
```

**Commands**

| Command                                                             | Description                |
| ------------------------------------------------------------------- | -------------------------- |
| [`staticwebsite deploy`](cli/staticwebsite.md#staticwebsite-deploy) | Deploy a static website    |
| [`staticwebsite list`](cli/staticwebsite.md#staticwebsite-list)     | List all static websites   |
| [`staticwebsite get`](cli/staticwebsite.md#staticwebsite-get)       | Get static website details |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

Deploy and manage static websites on Tailor Platform.

<!-- politty:command:staticwebsite:end -->
<!-- politty:command:staticwebsite deploy:start -->

#### staticwebsite deploy

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

#### staticwebsite get

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

#### staticwebsite list

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
<!-- politty:command:tailordb:start -->

### tailordb

Manage TailorDB operations

**Usage**

```
tailor-sdk tailordb [command]
```

**Commands**

| Command                                                  | Description                         |
| -------------------------------------------------------- | ----------------------------------- |
| [`tailordb truncate`](cli/tailordb.md#tailordb-truncate) | Delete records from TailorDB tables |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

TailorDB is the database service for your Tailor Platform applications.

<!-- politty:command:tailordb:end -->
<!-- politty:command:tailordb truncate:start -->

#### tailordb truncate

Delete records from TailorDB tables

**Usage**

```
tailor-sdk tailordb truncate [options]
```

**Options**

| Option                    | Alias | Description                           | Default | Env                   |
| ------------------------- | ----- | ------------------------------------- | ------- | --------------------- |
| `--all`                   | -     | Truncate all tables                   | `false` | -                     |
| `--namespace <namespace>` | -     | Truncate tables in specific namespace | -       | -                     |
| `--type-name <type>`      | -     | Truncate specific type                | -       | -                     |
| `--workspace-id <id>`     | `-w`  | Target workspace ID                   | -       | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`        | `-p`  | Profile to use                        | -       | -                     |
| `--yes`                   | `-y`  | Skip confirmation prompts             | `false` | -                     |

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

You must specify one of:
--all Truncate all tables
--namespace Truncate tables in a specific namespace
--type-name Truncate a specific type

<!-- politty:command:tailordb truncate:end -->
<!-- politty:command:type-generator:start -->

### type-generator

Generate TypeScript types from your schema

**Usage**

```
tailor-sdk type-generator [options]
```

**Options**

| Option            | Alias | Description                          | Default              |
| ----------------- | ----- | ------------------------------------ | -------------------- |
| `--config <path>` | `-c`  | Path to SDK configuration file       | `"tailor.config.ts"` |
| `--output <dir>`  | `-o`  | Output directory for generated types | -                    |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

<!-- politty:command:type-generator:end -->
<!-- politty:command:user:start -->

### user

Manage Tailor Platform users

**Usage**

```
tailor-sdk user [command]
```

**Commands**

| Command                                    | Description                              |
| ------------------------------------------ | ---------------------------------------- |
| [`user current`](cli/user.md#user-current) | Display the currently logged-in user     |
| [`user list`](cli/user.md#user-list)       | List all authenticated users             |
| [`user switch`](cli/user.md#user-switch)   | Switch to a different authenticated user |
| [`user pat`](cli/user.md#user-pat)         | Manage personal access tokens            |

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

#### user current

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

#### user list

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

#### user pat

Manage personal access tokens

**Usage**

```
tailor-sdk user pat [command]
```

**Commands**

| Command                                          | Description                        |
| ------------------------------------------------ | ---------------------------------- |
| [`user pat create`](cli/user.md#user-pat-create) | Create a new personal access token |
| [`user pat delete`](cli/user.md#user-pat-delete) | Delete a personal access token     |
| [`user pat list`](cli/user.md#user-pat-list)     | List all personal access tokens    |
| [`user pat update`](cli/user.md#user-pat-update) | Update a personal access token     |

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

##### user pat create

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

##### user pat delete

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

##### user pat list

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

##### user pat update

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

#### user switch

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
<!-- politty:command:workflow:start -->

### workflow

Manage Tailor Platform workflows

**Usage**

```
tailor-sdk workflow [command]
```

**Commands**

| Command                                                      | Description                         |
| ------------------------------------------------------------ | ----------------------------------- |
| [`workflow list`](cli/workflow.md#workflow-list)             | List all workflows                  |
| [`workflow get`](cli/workflow.md#workflow-get)               | Get workflow details                |
| [`workflow start`](cli/workflow.md#workflow-start)           | Start a workflow execution          |
| [`workflow executions`](cli/workflow.md#workflow-executions) | List and manage workflow executions |
| [`workflow resume`](cli/workflow.md#workflow-resume)         | Resume a paused workflow execution  |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

Workflows allow you to orchestrate complex business processes.
You can start, monitor, and manage workflow executions.

<!-- politty:command:workflow:end -->
<!-- politty:command:workflow executions:start -->

#### workflow executions

List and manage workflow executions

**Usage**

```
tailor-sdk workflow executions [options]
```

**Options**

| Option                     | Alias | Description                     | Default | Env                   |
| -------------------------- | ----- | ------------------------------- | ------- | --------------------- |
| `--filter-workflow <name>` | -     | Filter by workflow name         | -       | -                     |
| `--filter-status <status>` | -     | Filter by execution status      | -       | -                     |
| `--wait`                   | -     | Wait for executions to complete | `false` | -                     |
| `--log`                    | -     | Stream execution logs           | `false` | -                     |
| `--workspace-id <id>`      | `-w`  | Target workspace ID             | -       | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`         | `-p`  | Profile to use                  | -       | -                     |
| `--json`                   | `-j`  | Output in JSON format           | `false` | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

<!-- politty:command:workflow executions:end -->
<!-- politty:command:workflow get:start -->

#### workflow get

Get workflow details

**Usage**

```
tailor-sdk workflow get [options] <name>
```

**Arguments**

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `name`   | Workflow name | Yes      |

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

<!-- politty:command:workflow get:end -->
<!-- politty:command:workflow list:start -->

#### workflow list

List all workflows

**Usage**

```
tailor-sdk workflow list [options]
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

<!-- politty:command:workflow list:end -->
<!-- politty:command:workflow resume:start -->

#### workflow resume

Resume a paused workflow execution

**Usage**

```
tailor-sdk workflow resume [options] <executionId>
```

**Arguments**

| Argument      | Description            | Required |
| ------------- | ---------------------- | -------- |
| `executionId` | Execution ID to resume | Yes      |

**Options**

| Option                | Alias | Description                  | Default | Env                   |
| --------------------- | ----- | ---------------------------- | ------- | --------------------- |
| `--wait`              | -     | Wait for workflow completion | `false` | -                     |
| `--log`               | -     | Stream workflow logs         | `false` | -                     |
| `--workspace-id <id>` | `-w`  | Target workspace ID          | -       | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`    | `-p`  | Profile to use               | -       | -                     |
| `--json`              | `-j`  | Output in JSON format        | `false` | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

<!-- politty:command:workflow resume:end -->
<!-- politty:command:workflow start:start -->

#### workflow start

Start a workflow execution

**Usage**

```
tailor-sdk workflow start [options] <name>
```

**Arguments**

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `name`   | Workflow name | Yes      |

**Options**

| Option                  | Alias | Description                     | Default | Env                   |
| ----------------------- | ----- | ------------------------------- | ------- | --------------------- |
| `--machine-user <user>` | -     | Machine user for authentication | -       | -                     |
| `--json-args <json>`    | -     | JSON arguments for the workflow | -       | -                     |
| `--wait`                | -     | Wait for workflow completion    | `false` | -                     |
| `--log`                 | -     | Stream workflow logs            | `false` | -                     |
| `--workspace-id <id>`   | `-w`  | Target workspace ID             | -       | `TAILOR_WORKSPACE_ID` |
| `--profile <name>`      | `-p`  | Profile to use                  | -       | -                     |
| `--json`                | `-j`  | Output in JSON format           | `false` | -                     |

**Examples**

**undefined**

```bash
$ undefined
```

**undefined**

```bash
$ undefined
```

<!-- politty:command:workflow start:end -->
<!-- politty:command:workspace:start -->

### workspace

Manage Tailor Platform workspaces

**Usage**

```
tailor-sdk workspace [command]
```

**Commands**

| Command                                                 | Description            |
| ------------------------------------------------------- | ---------------------- |
| [`workspace create`](cli/workspace.md#workspace-create) | Create a new workspace |
| [`workspace list`](cli/workspace.md#workspace-list)     | List all workspaces    |
| [`workspace delete`](cli/workspace.md#workspace-delete) | Delete a workspace     |

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

#### workspace create

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

#### workspace delete

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

#### workspace list

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
