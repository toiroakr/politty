# 30-template-docs

> `README.template.md` is the documentation source. `README.md` is generated
> from it and must not be edited by hand.

This example demonstrates **template-based documentation generation**: the
generated `README.md` contains no politty markers because all generated
content is expanded from the politty placeholders in this template.

# task-cli

A tiny task manager CLI

**Usage**

```
task-cli [command]
```

**Commands**

| Command         | Description    |
| --------------- | -------------- |
| [`add`](#add)   | Add a new task |
| [`list`](#list) | List tasks     |

## Subcommands in detail

The sections below are fully generated from the command definitions.

## add

Add a new task

**Usage**

```
task-cli add [options] <title>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `title`  | Task title  | Yes      |

**Options**

| Option                  | Alias | Description   | Required | Default |
| ----------------------- | ----- | ------------- | -------- | ------- |
| `--priority <PRIORITY>` | `-p`  | Task priority | No       | `"mid"` |

**Examples**

**Add a task with default priority**

```bash
$ task-cli add "Buy milk"
Added task: Buy milk (priority: mid)
```

**Add a high-priority task**

```bash
$ task-cli add "Ship release" -p high
Added task: Ship release (priority: high)
```

You can also embed single sections with typed placeholders of the form
`politty:command:<scope>:<type>` (wrapped in double curly braces). The `list`
section below intentionally omits the usage block:

## list

List tasks

**Options**

| Option   | Alias | Description             | Required | Default |
| -------- | ----- | ----------------------- | -------- | ------- |
| `--done` | `-d`  | Include completed tasks | No       | `false` |

## Closing notes

Handwritten content can appear anywhere around the placeholders, before and
after generated sections.
