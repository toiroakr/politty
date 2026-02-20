<!-- politty:heading::start -->

# db-query

<!-- politty:heading::end -->

<!-- politty:description::start -->

Execute database query (lifecycle hooks demo)

<!-- politty:description::end -->

<!-- politty:usage::start -->

**Usage**

```
db-query [options]
```

<!-- politty:usage::end -->

<!-- politty:options::start -->

**Options**

| Option                  | Alias | Description                | Required | Default |
| ----------------------- | ----- | -------------------------- | -------- | ------- |
| `--database <DATABASE>` | `-d`  | Database connection string | Yes      | -       |
| `--query <QUERY>`       | `-q`  | SQL query                  | Yes      | -       |
| `--simulate_error`      | `-e`  | Simulate an error          | No       | `false` |

<!-- politty:options::end -->

<!-- politty:notes::start -->

**Notes**

## Execution Order

1. `setup` — Initialize resources (e.g. DB connection)
2. `run` — Execute the main logic
3. `cleanup` — Release resources (always runs, even on error)

> [!WARNING]
> When `--simulate-error` is set, an error is thrown during `run`.
> The `cleanup` hook is still called to release resources.

<!-- politty:notes::end -->
