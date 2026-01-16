# TailorDB Commands

Commands for managing TailorDB operations.

<!-- politty:command:tailordb:start -->

## tailordb

Manage TailorDB operations

**Usage**

```
tailor-sdk tailordb [command]
```

**Commands**

| Command                                   | Description                         |
| ----------------------------------------- | ----------------------------------- |
| [`tailordb truncate`](#tailordb-truncate) | Delete records from TailorDB tables |

**Examples**

**undefined**

```bash
$ undefined
```

**Notes**

TailorDB is the database service for your Tailor Platform applications.

<!-- politty:command:tailordb:end -->
<!-- politty:command:tailordb truncate:start -->

### tailordb truncate

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
