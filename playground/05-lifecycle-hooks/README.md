<!-- politty:command::start -->

# db-query

Execute database query (lifecycle hooks demo)

**Usage**

```
db-query [options]
```

**Options**

| Option                  | Alias | Description                | Default |
| ----------------------- | ----- | -------------------------- | ------- |
| `--database <DATABASE>` | `-d`  | Database connection string | -       |
| `--query <QUERY>`       | `-q`  | SQL query                  | -       |
| `--simulate_error`      | `-e`  | Simulate an error          | `false` |

**Notes**

## Execution Order

1. `setup` — Initialize resources (e.g. DB connection)
2. `run` — Execute the main logic
3. `cleanup` — Release resources (always runs, even on error)

> [!WARNING]
> When `--simulate-error` is set, an error is thrown during `run`.
> The `cleanup` hook is still called to release resources.

<!-- politty:command::end -->
