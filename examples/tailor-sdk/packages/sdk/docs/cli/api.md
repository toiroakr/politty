# API Commands

Commands for API operations and type generation.

<!-- politty:command:api:start -->

## api

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
<!-- politty:command:type-generator:start -->

## type-generator

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
