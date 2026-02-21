<!-- politty:command::heading:start -->

# db-query

<!-- politty:command::heading:end -->

<!-- politty:command::description:start -->

Execute database query (lifecycle hooks demo)

<!-- politty:command::description:end -->

<!-- politty:command::usage:start -->

**Usage**

```
db-query [options]
```

<!-- politty:command::usage:end -->

<!-- politty:command::options:start -->

**Options**

| Option                  | Alias | Description                | Required | Default |
| ----------------------- | ----- | -------------------------- | -------- | ------- |
| `--database <DATABASE>` | `-d`  | Database connection string | Yes      | -       |
| `--query <QUERY>`       | `-q`  | SQL query                  | Yes      | -       |
| `--simulate_error`      | `-e`  | Simulate an error          | No       | `false` |

<!-- politty:command::options:end -->

<!-- politty:command::notes:start -->

**Notes**

## Execution Order

1. `setup` — Initialize resources (e.g. DB connection)
2. `run` — Execute the main logic
3. `cleanup` — Release resources (always runs, even on error)

> [!WARNING]
> When `--simulate-error` is set, an error is thrown during `run`.
> The `cleanup` hook is still called to release resources.

<!-- politty:command::notes:end -->
