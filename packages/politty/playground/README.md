# Playground

Sample code for testing politty functionality.

## How to Run

Each file can be executed with `pnpx tsx`.

```bash
# Basic execution
pnpx tsx playground/01-hello-world.ts

# Execution with arguments
pnpx tsx playground/02-greet.ts World -g "Hi" -l

# Show help
pnpx tsx playground/10-subcommands.ts --help
```

## File List

### Basic

| File                    | Description                                   |
| ----------------------- | --------------------------------------------- |
| `01-hello-world.ts`     | Minimal command configuration                 |
| `02-greet.ts`           | Positional arguments and options              |
| `03-array-args.ts`      | Array arguments (`--file a.txt --file b.txt`) |
| `04-type-coercion.ts`   | Type coercion and validation (`z.coerce`)     |
| `05-lifecycle-hooks.ts` | setup/run/cleanup hooks                       |

### Positional Arguments

| File                    | Description                               |
| ----------------------- | ----------------------------------------- |
| `06-cp-command.ts`      | cp command style (multiple positional)    |
| `07-gcc-command.ts`     | gcc command style (array positional)      |
| `08-cat-command.ts`     | cat command style (array positional only) |
| `09-convert-command.ts` | Optional positional arguments             |

### Advanced

| File                            | Description                                   |
| ------------------------------- | --------------------------------------------- |
| `10-subcommands.ts`             | Subcommands                                   |
| `11-nested-subcommands.ts`      | Nested subcommands                            |
| `12-discriminated-union.ts`     | Discriminated union (mutually exclusive opts) |
| `13-intersection.ts`            | Intersection (reusing common options)         |
| `14-transform-refine.ts`        | transform/refine (conversion and validation)  |
| `15-complete-cli.ts`            | Complete CLI example                          |
| `16-show-subcommand-options.ts` | Display subcommand options together           |

## Examples

### 02-greet.ts

```bash
# Basic usage
pnpx tsx playground/02-greet.ts World
# Output: Hello, World!

# With options
pnpx tsx playground/02-greet.ts World -g "Hi" -l
# Output: HI, WORLD!

# Show help
pnpx tsx playground/02-greet.ts --help
```

### 10-subcommands.ts

```bash
# Show help
pnpx tsx playground/10-subcommands.ts --help

# init subcommand
pnpx tsx playground/10-subcommands.ts init -t react

# build subcommand
pnpx tsx playground/10-subcommands.ts build -o out -m
```

### 12-discriminated-union.ts

```bash
# create action
pnpx tsx playground/12-discriminated-union.ts --action create --name my-resource

# delete action
pnpx tsx playground/12-discriminated-union.ts --action delete --id 123 -f

# list action
pnpx tsx playground/12-discriminated-union.ts --action list -f json
```

### 16-show-subcommand-options.ts

```bash
# Basic help
pnpx tsx playground/16-show-subcommand-options.ts --help

# Detailed help (shows subcommand options)
pnpx tsx playground/16-show-subcommand-options.ts --help-all  # or -H

# Subcommand help
pnpx tsx playground/16-show-subcommand-options.ts config list --help

# --help-all output example:
# Commands:
#   config                      Manage configuration
#   config get                  Get a config value
#   config set                  Set a config value
#   config list                 List all config values
#     -f, --format <FORMAT>     Output format (default: "table")
#     -g, --global              Show global configuration (default: false)
```
