# Workflow Commands

Commands for managing and executing workflows.

<!-- politty:command:workflow:start -->

## workflow

Manage Tailor Platform workflows

**Usage**

```
tailor-sdk workflow [command]
```

**Commands**

| Command                                       | Description                         |
| --------------------------------------------- | ----------------------------------- |
| [`workflow list`](#workflow-list)             | List all workflows                  |
| [`workflow get`](#workflow-get)               | Get workflow details                |
| [`workflow start`](#workflow-start)           | Start a workflow execution          |
| [`workflow executions`](#workflow-executions) | List and manage workflow executions |
| [`workflow resume`](#workflow-resume)         | Resume a paused workflow execution  |

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

### workflow executions

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

### workflow get

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

### workflow list

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

### workflow resume

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

### workflow start

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
